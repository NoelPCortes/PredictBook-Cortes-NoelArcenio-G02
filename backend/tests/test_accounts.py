from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib import admin
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework_simplejwt.backends import TokenBackend
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken, Token

from accounts.models import StaffAssignment, User
from accounts.permissions import IsStaffOrHead
from flights.models import Airline, Airport, Flight
from traffic.models import CrowdForecast, HistoricalRecord

pytestmark = pytest.mark.django_db
PASSWORD = "Starlight-River-927!"
PROFILE_FIELDS = {"id", "username", "email", "first_name", "last_name", "role"}


@pytest.fixture(autouse=True)
def fast_password_hashing(settings, monkeypatch):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    settings.SECRET_KEY = "test-only-signing-key-with-at-least-32-characters"
    monkeypatch.setattr(
        Token,
        "_token_backend",
        TokenBackend(algorithm="HS256", signing_key=settings.SECRET_KEY),
    )


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def make_user():
    def create(username, role="traveler", **fields):
        return User.objects.create_user(
            username=username,
            email=f"{username}@example.com",
            password=PASSWORD,
            role=role,
            **fields,
        )

    return create


@pytest.fixture
def head(make_user):
    return make_user("head", "head")


def authorize(client, user):
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}"
    )


def post(client, endpoint, **fields):
    return client.post(f"/api/accounts/{endpoint}/", fields, format="json")


def signup_fields(**overrides):
    return {
        "username": "newuser",
        "email": "newuser@example.com",
        "password": PASSWORD,
        **overrides,
    }


@pytest.mark.parametrize(
    "role,dashboard_status,head_status",
    [("traveler", 403, 403), ("staff", 200, 403), ("head", 200, 200)],
)
def test_role_area_endpoints_enforce_current_role(
    client,
    make_user,
    role,
    dashboard_status,
    head_status,
):
    authorize(client, make_user("actor", role))
    dashboard_response = client.get("/api/dashboard/")
    head_response = client.get("/api/accounts/head/")
    assert dashboard_response.status_code == dashboard_status
    assert head_response.status_code == head_status
    if dashboard_status == 200:
        assert set(dashboard_response.data) == {"detail", "is_sample"}
        assert dashboard_response.data["is_sample"] is True
        assert "sample data" in dashboard_response.data["detail"]
    if head_status == 200:
        assert set(head_response.data) == {"detail"}


@pytest.mark.parametrize("path", ["/api/dashboard/", "/api/accounts/head/"])
def test_role_area_endpoints_require_authentication(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", ["/api/dashboard/", "/api/accounts/head/"])
def test_role_area_endpoints_reject_access_after_role_revocation(
    client, make_user, path
):
    user = make_user("actor", "head")
    authorize(client, user)
    assert client.get(path).status_code == 200
    user.role = "traveler"
    user.save(update_fields=["role"])
    assert client.get(path).status_code == 403


@pytest.mark.parametrize("path", ["/api/dashboard/", "/api/accounts/head/"])
def test_django_admin_flags_do_not_grant_role_area_access(client, make_user, path):
    authorize(client, make_user("admin", is_staff=True, is_superuser=True))
    assert client.get(path).status_code == 403


def test_signup_hashes_password_and_returns_only_safe_profile(client):
    response = post(
        client, "signup", **signup_fields(first_name="Ada", last_name="Lee")
    )
    assert response.status_code == 201
    assert set(response.data) == PROFILE_FIELDS
    user = User.objects.get(username="newuser")
    assert user.check_password(PASSWORD)
    assert user.password != PASSWORD
    assert user.role == "traveler"
    assert user.promoted_by is None
    assert user.first_name == "Ada"


@pytest.mark.parametrize("field,value", [("role", "head"), ("promoted_by", None)])
def test_signup_rejects_privilege_fields(client, field, value):
    response = post(client, "signup", **signup_fields(**{field: value}))
    assert response.status_code == 400
    assert field in response.data
    assert not User.objects.exists()


def test_signup_consumes_pending_assignment(client, head):
    StaffAssignment.objects.create(email="newuser@example.com", assigned_by=head)
    response = post(client, "signup", **signup_fields())
    assert response.status_code == 201
    assert response.data["role"] == "staff"
    assert not StaffAssignment.objects.exists()


def test_signup_rolls_back_account_when_assignment_deletion_fails(client, head):
    StaffAssignment.objects.create(email="newuser@example.com", assigned_by=head)
    with patch.object(StaffAssignment, "delete", side_effect=IntegrityError):
        response = post(client, "signup", **signup_fields())
    assert response.status_code == 400
    assert not User.objects.filter(username="newuser").exists()
    assert StaffAssignment.objects.count() == 1


@pytest.mark.parametrize("password", ["123", "password", "123456789012", "newuser"])
def test_signup_returns_default_password_validation_messages(client, password):
    response = post(client, "signup", **signup_fields(password=password))
    assert response.status_code == 400
    assert response.data["password"]


@pytest.mark.parametrize("field", ["username", "email"])
@pytest.mark.parametrize("case_variant", [False, True])
def test_signup_rejects_duplicate_identity(client, make_user, field, case_variant):
    existing = make_user("existing")
    value = getattr(existing, field)
    response = post(
        client, "signup", **signup_fields(**{field: value.upper() if case_variant else value})
    )
    assert response.status_code == 400
    assert field in response.data


@pytest.mark.parametrize("identifier", ["traveler", "traveler@example.com"])
def test_signin_accepts_username_or_email(client, make_user, identifier):
    user = make_user("traveler")
    response = post(client, "signin", identifier=identifier, password=PASSWORD)
    assert response.status_code == 200
    assert set(response.data) == {"access", "refresh", "profile"}
    assert set(response.data["profile"]) == PROFILE_FIELDS
    access = AccessToken(response.data["access"])
    refresh = RefreshToken(response.data["refresh"])
    assert access["exp"] - access["iat"] == 15 * 60
    assert refresh["exp"] - refresh["iat"] == 7 * 24 * 60 * 60
    user.refresh_from_db()
    assert user.last_login is not None


def test_signin_uses_same_error_for_wrong_identity_password_and_inactive_user(
    client, make_user
):
    user = make_user("traveler")
    failures = [
        post(client, "signin", identifier="missing", password=PASSWORD),
        post(client, "signin", identifier=user.email, password="wrong"),
    ]
    user.is_active = False
    user.save()
    failures.append(post(client, "signin", identifier=user.username, password=PASSWORD))
    assert all(response.status_code == 401 for response in failures)
    assert all(response.data == failures[0].data for response in failures)


def test_refresh_rotates_and_blacklists_previous_token(client, make_user):
    token = str(RefreshToken.for_user(make_user("traveler")))
    response = post(client, "token/refresh", refresh=token)
    assert response.status_code == 200
    assert set(response.data) == {"access", "refresh"}
    assert response.data["refresh"] != token
    assert post(client, "token/refresh", refresh=token).status_code == 401
    assert (
        post(client, "token/refresh", refresh=response.data["refresh"]).status_code
        == 200
    )


def test_logout_blacklists_refresh_token(client, make_user):
    user = make_user("traveler")
    authorize(client, user)
    token = str(RefreshToken.for_user(user))
    assert post(client, "logout", refresh=token).status_code == 200
    assert post(client, "token/refresh", refresh=token).status_code == 401


def test_logout_cannot_blacklist_another_users_refresh_token(client, make_user):
    authorize(client, make_user("traveler"))
    token = str(RefreshToken.for_user(make_user("other")))
    assert post(client, "logout", refresh=token).status_code == 403
    assert post(client, "token/refresh", refresh=token).status_code == 200


@pytest.mark.parametrize("endpoint", ["logout", "token/refresh"])
def test_invalid_refresh_is_rejected(client, make_user, endpoint):
    authorize(client, make_user("traveler"))
    assert post(client, endpoint, refresh="invalid").status_code == 401


def test_profile_view_and_update_are_limited_to_current_user(client, make_user):
    user = make_user("traveler")
    other = make_user("other")
    authorize(client, user)
    response = client.get("/api/accounts/profile/")
    assert response.status_code == 200
    assert response.data["id"] == user.pk
    assert set(response.data) == PROFILE_FIELDS
    response = client.patch(
        "/api/accounts/profile/",
        {
            "username": "updated",
            "email": "updated@example.com",
            "first_name": "Ada",
            "last_name": "Lee",
        },
        format="json",
    )
    assert response.status_code == 200
    user.refresh_from_db()
    other.refresh_from_db()
    assert user.username == "updated"
    assert other.username == "other"
    assert (
        client.patch(
            "/api/accounts/profile/", {"id": other.pk}, format="json"
        ).status_code
        == 400
    )


@pytest.mark.parametrize(
    "field,value", [("role", "head"), ("promoted_by", None), ("password", "bad")]
)
def test_profile_rejects_protected_fields(client, make_user, field, value):
    authorize(client, make_user("traveler"))
    response = client.patch("/api/accounts/profile/", {field: value}, format="json")
    assert response.status_code == 400


@pytest.mark.parametrize("field", ["username", "email"])
@pytest.mark.parametrize("case_variant", [False, True])
def test_profile_rejects_duplicate_identity(client, make_user, field, case_variant):
    authorize(client, make_user("traveler"))
    other = make_user("other")
    value = getattr(other, field)
    response = client.patch(
        "/api/accounts/profile/", {field: value.upper() if case_variant else value}, format="json"
    )
    assert response.status_code == 400
    assert field in response.data


def test_password_change_requires_current_password_and_default_validators(
    client, make_user
):
    user = make_user("traveler")
    authorize(client, user)
    response = post(
        client, "password/change", current_password="wrong", new_password=PASSWORD
    )
    assert response.status_code == 400
    assert "current_password" in response.data
    response = post(
        client, "password/change", current_password=PASSWORD, new_password="123"
    )
    assert response.status_code == 400
    assert "new_password" in response.data
    new_password = "Updated-Starlight-583!"
    assert (
        post(
            client,
            "password/change",
            current_password=PASSWORD,
            new_password=new_password,
        ).status_code
        == 200
    )
    user.refresh_from_db()
    assert user.check_password(new_password)
    assert (
        post(client, "signin", identifier=user.username, password=PASSWORD).status_code
        == 401
    )
    assert (
        post(
            client, "signin", identifier=user.username, password=new_password
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "endpoint",
    [
        "logout",
        "password/change",
        "staff/assign",
        "heads/promote",
        "heads/remove",
        "staff/revoke",
    ],
)
def test_protected_endpoints_require_authentication(client, endpoint):
    assert post(client, endpoint).status_code == 401


def test_profile_requires_authentication(client):
    assert client.get("/api/accounts/profile/").status_code == 401
    assert client.patch("/api/accounts/profile/", {}, format="json").status_code == 401


@pytest.mark.parametrize("role", ["traveler", "staff", "head"])
def test_each_role_can_save_and_reload_only_its_own_profile(client, make_user, role):
    user = make_user("actor", role)
    other = make_user("other")
    authorize(client, user)
    fields = {
        "username": "updated_actor",
        "email": "updated_actor@example.com",
        "first_name": "Ada",
        "last_name": "Lee",
    }
    response = client.patch("/api/accounts/profile/", fields, format="json")
    assert response.status_code == 200
    reloaded = client.get("/api/accounts/profile/")
    assert reloaded.status_code == 200
    assert reloaded.data == {"id": user.pk, "role": role, **fields}
    assert set(reloaded.data) == PROFILE_FIELDS
    other.refresh_from_db()
    assert other.username == "other"
    assert other.email == "other@example.com"
    assert other.first_name == ""
    assert other.last_name == ""


@pytest.mark.parametrize("field", ["role", "promoted_by"])
@pytest.mark.parametrize("value", [None, "", "head", 1])
def test_profile_rejects_privilege_fields_without_partial_updates(
    client,
    make_user,
    field,
    value,
):
    user = make_user("actor")
    authorize(client, user)
    response = client.patch(
        "/api/accounts/profile/",
        {"first_name": "Changed", field: value},
        format="json",
    )
    assert response.status_code == 400
    assert field in response.data
    user.refresh_from_db()
    assert user.first_name == ""
    assert user.role == "traveler"
    assert user.promoted_by is None


@pytest.mark.parametrize("field", ["username", "email"])
def test_duplicate_profile_identity_does_not_change_either_account(
    client,
    make_user,
    field,
):
    user = make_user("actor")
    other = make_user("other")
    authorize(client, user)
    response = client.patch(
        "/api/accounts/profile/",
        {field: getattr(other, field), "first_name": "Changed"},
        format="json",
    )
    assert response.status_code == 400
    assert field in response.data
    user.refresh_from_db()
    other.refresh_from_db()
    assert user.username == "actor"
    assert user.email == "actor@example.com"
    assert user.first_name == ""
    assert other.username == "other"
    assert other.email == "other@example.com"


@pytest.mark.parametrize("identifier", ["id", "user_id"])
def test_profile_cannot_be_read_or_changed_by_targeting_another_user(
    client,
    make_user,
    identifier,
):
    user = make_user("actor")
    other = make_user("other", first_name="Private")
    authorize(client, user)
    response = client.get("/api/accounts/profile/", {identifier: other.pk})
    assert response.status_code == 200
    assert response.data["id"] == user.pk
    assert response.data["first_name"] == ""
    response = client.patch(
        "/api/accounts/profile/",
        {identifier: other.pk, "first_name": "Changed"},
        format="json",
    )
    assert response.status_code == 400
    user.refresh_from_db()
    other.refresh_from_db()
    assert user.first_name == ""
    assert other.first_name == "Private"


def test_profile_does_not_expose_user_id_routes(client, make_user):
    authorize(client, make_user("actor"))
    other = make_user("other")
    path = f"/api/accounts/profile/{other.pk}/"
    assert client.get(path).status_code == 404
    assert (
        client.patch(path, {"first_name": "Changed"}, format="json").status_code == 404
    )
    other.refresh_from_db()
    assert other.first_name == ""


@pytest.mark.parametrize("role", ["traveler", "staff", "head"])
def test_password_change_updates_only_the_signed_in_user(client, make_user, role):
    user = make_user("actor", role)
    other = make_user("other")
    authorize(client, user)
    new_password = "Updated-River-427!"
    response = post(
        client,
        "password/change",
        current_password=PASSWORD,
        new_password=new_password,
    )
    assert response.status_code == 200
    assert set(response.data) == {"detail"}
    user.refresh_from_db()
    other.refresh_from_db()
    assert user.check_password(new_password)
    assert not user.check_password(PASSWORD)
    assert other.check_password(PASSWORD)
    assert user.role == role


@pytest.mark.parametrize("identifier", ["id", "user_id"])
def test_password_change_rejects_another_user_identifier(client, make_user, identifier):
    user = make_user("actor")
    other = make_user("other")
    authorize(client, user)
    response = post(
        client,
        "password/change",
        current_password=PASSWORD,
        new_password="Updated-River-427!",
        **{identifier: other.pk},
    )
    assert response.status_code == 400
    assert identifier in response.data
    user.refresh_from_db()
    other.refresh_from_db()
    assert user.check_password(PASSWORD)
    assert other.check_password(PASSWORD)


@pytest.mark.parametrize("new_password", ["123", "password", "123456789012", "actor"])
def test_failed_password_validators_leave_the_password_unchanged(
    client,
    make_user,
    new_password,
):
    user = make_user("actor")
    authorize(client, user)
    response = post(
        client,
        "password/change",
        current_password=PASSWORD,
        new_password=new_password,
    )
    assert response.status_code == 400
    assert response.data["new_password"]
    user.refresh_from_db()
    assert user.check_password(PASSWORD)


def test_another_users_password_cannot_authorize_a_password_change(client, make_user):
    user = make_user("actor")
    other = make_user("other")
    other.set_password("Other-Account-Password-738!")
    other.save(update_fields=["password"])
    authorize(client, user)
    response = post(
        client,
        "password/change",
        current_password="Other-Account-Password-738!",
        new_password="Updated-River-427!",
    )
    assert response.status_code == 400
    assert response.data["current_password"]
    user.refresh_from_db()
    other.refresh_from_db()
    assert user.check_password(PASSWORD)
    assert other.check_password("Other-Account-Password-738!")


@pytest.mark.parametrize("role", ["traveler", "staff"])
@pytest.mark.parametrize(
    "endpoint", ["staff/assign", "heads/promote", "heads/remove", "staff/revoke"]
)
def test_management_requires_head_role(client, make_user, role, endpoint):
    user = make_user("actor", role, is_staff=True, is_superuser=True)
    authorize(client, user)
    assert (
        post(client, endpoint, email="target@example.com", role="staff").status_code
        == 403
    )


def test_assign_staff_updates_existing_account_without_pending_row(
    client, head, make_user
):
    target = make_user("traveler")
    authorize(client, head)
    response = post(client, "staff/assign", email=target.email)
    assert response.status_code == 200
    assert set(response.data) == {"detail"}
    target.refresh_from_db()
    assert target.role == "staff"
    assert not StaffAssignment.objects.exists()


@pytest.mark.parametrize("role", ["staff", "head"])
def test_assign_staff_does_not_change_staff_or_head(client, head, make_user, role):
    target = make_user("target", role)
    authorize(client, head)
    response = post(client, "staff/assign", email=target.email)
    assert response.status_code == 200
    assert "no change" in response.data["detail"]
    target.refresh_from_db()
    assert target.role == role
    assert not StaffAssignment.objects.exists()


def test_pending_assignment_can_be_created_repeated_and_revoked(client, head):
    authorize(client, head)
    assert post(client, "staff/assign", email="pending@example.com").status_code == 200
    assert post(client, "staff/assign", email="pending@example.com").status_code == 200
    assignment = StaffAssignment.objects.get()
    assert assignment.assigned_by == head
    assert post(client, "staff/revoke", email=assignment.email).status_code == 200
    assert not StaffAssignment.objects.exists()


def test_promote_staff_records_acting_head(client, head, make_user):
    target = make_user("target", "staff")
    authorize(client, head)
    assert post(client, "heads/promote", email=target.email).status_code == 200
    target.refresh_from_db()
    assert target.role == "head"
    assert target.promoted_by == head


@pytest.mark.parametrize("role", ["traveler", "head"])
def test_only_staff_can_be_promoted(client, head, make_user, role):
    target = make_user("target", role)
    authorize(client, head)
    assert post(client, "heads/promote", email=target.email).status_code == 400


@pytest.mark.parametrize("outcome", ["staff", "traveler"])
@pytest.mark.parametrize("self_removal", [False, True])
def test_head_removal_clears_promoter_and_preserves_downstream_heads(
    client, head, make_user, outcome, self_removal
):
    target = head if self_removal else make_user("target", "head", promoted_by=head)
    descendant = make_user("descendant", "head", promoted_by=target)
    authorize(client, head)
    assert (
        post(client, "heads/remove", email=target.email, role=outcome).status_code
        == 200
    )
    target.refresh_from_db()
    descendant.refresh_from_db()
    assert target.role == outcome
    assert target.promoted_by is None
    assert descendant.role == "head"
    assert descendant.promoted_by == target
    assert User.objects.count() == (2 if self_removal else 3)
    if self_removal:
        assert (
            post(client, "staff/assign", email="pending@example.com").status_code == 403
        )


def test_head_cannot_remove_promoter_unrelated_head_or_admin_created_head(
    client, head, make_user
):
    actor = make_user("actor", "head", promoted_by=head)
    unrelated = make_user("unrelated", "head", promoted_by=head)
    initial = make_user("initial", "head")
    authorize(client, actor)
    for target in (head, unrelated, initial):
        assert (
            post(
                client, "heads/remove", email=target.email, role="traveler"
            ).status_code
            == 403
        )


@pytest.mark.parametrize("role", [None, "head", "invalid"])
def test_head_removal_requires_valid_outcome(client, head, role):
    authorize(client, head)
    fields = {"email": head.email}
    if role is not None:
        fields["role"] = role
    assert post(client, "heads/remove", **fields).status_code == 400


def test_revoke_staff_preserves_account_and_cannot_bypass_head_removal(
    client, head, make_user
):
    target = make_user("target", "staff")
    authorize(client, head)
    assert post(client, "staff/revoke", email=target.email).status_code == 200
    target.refresh_from_db()
    assert target.role == "traveler"
    assert post(client, "staff/revoke", email=head.email).status_code == 400
    assert User.objects.count() == 2


@pytest.mark.parametrize(
    "role,expected", [("traveler", False), ("staff", True), ("head", True)]
)
def test_staff_permission_includes_heads(make_user, role, expected):
    request = APIRequestFactory().get("/")
    request.user = make_user("actor", role)
    assert IsStaffOrHead().has_permission(request, None) == expected


def test_user_admin_exposes_role_and_promoter_without_registering_other_models():
    registration = admin.site._registry[User]
    assert "role" in str(registration.fieldsets)
    assert "promoted_by" in str(registration.add_fieldsets)
    for model in (
        StaffAssignment,
        Airport,
        Airline,
        Flight,
        CrowdForecast,
        HistoricalRecord,
    ):
        assert model not in admin.site._registry


def test_user_relationship_deletion_is_protected(head, make_user):
    make_user("target", "head", promoted_by=head)
    with pytest.raises(ProtectedError):
        head.delete()
    assigner = make_user("assigner", "head")
    StaffAssignment.objects.create(email="pending@example.com", assigned_by=assigner)
    with pytest.raises(ProtectedError):
        assigner.delete()


@pytest.fixture
def flight_fields(make_user):
    origin = Airport.objects.create(
        code="CEB", name="Cebu", city="Cebu", country="Philippines"
    )
    destination = Airport.objects.create(
        code="MNL", name="Manila", city="Manila", country="Philippines"
    )
    airline = Airline.objects.create(name="Sample airline", code="SA")
    departure = timezone.now()
    return {
        "created_by": make_user("flight_owner", "staff"),
        "airline": airline,
        "flight_number": "SA100",
        "origin": origin,
        "destination": destination,
        "departure_time": departure,
        "arrival_time": departure + timedelta(hours=1),
        "total_seats": 100,
        "available_seats": 50,
    }


@pytest.mark.parametrize(
    "violation", ["route", "arrival", "negative_seats", "excess_seats", "duplicate"]
)
def test_flight_database_constraints(flight_fields, violation):
    Flight.objects.create(**flight_fields)
    invalid = {**flight_fields, "flight_number": "SA101"}
    if violation == "route":
        invalid["destination"] = invalid["origin"]
    elif violation == "arrival":
        invalid["arrival_time"] = invalid["departure_time"]
    elif violation == "negative_seats":
        invalid["available_seats"] = -1
    elif violation == "excess_seats":
        invalid["available_seats"] = 101
    else:
        invalid = flight_fields
    with pytest.raises(IntegrityError), transaction.atomic():
        Flight.objects.create(**invalid)


@pytest.mark.parametrize("available", [0, 100])
def test_flight_accepts_seat_boundaries(flight_fields, available):
    Flight.objects.create(**{**flight_fields, "available_seats": available})


def test_flight_creator_is_required_and_protected(flight_fields):
    flight = Flight.objects.create(**flight_fields)
    with pytest.raises(ProtectedError):
        flight.created_by.delete()
    without_owner = {key: value for key, value in flight_fields.items() if key != "created_by"}
    without_owner["flight_number"] = "SA102"
    with pytest.raises(IntegrityError), transaction.atomic():
        Flight.objects.create(**without_owner)


@pytest.mark.parametrize("model", [CrowdForecast, HistoricalRecord])
def test_traffic_airport_date_is_unique(flight_fields, model):
    fields = {"airport": flight_fields["origin"], "date": timezone.localdate()}
    if model is CrowdForecast:
        fields.update(crowd_level="low", calculated_at=timezone.now(), created_by=flight_fields["created_by"])
    else:
        fields.update(total_flights=1, seats_total=100, seats_booked=50)
    model.objects.create(**fields)
    with pytest.raises(IntegrityError), transaction.atomic():
        model.objects.create(**fields)


def test_flight_and_traffic_relationship_deletion_is_protected(flight_fields):
    flight = Flight.objects.create(**flight_fields)
    for parent in (flight.airline, flight.origin, flight.destination):
        with pytest.raises(ProtectedError):
            parent.delete()
    flight.delete()
    CrowdForecast.objects.create(
        created_by=flight_fields["created_by"],
        airport=flight.origin,
        date=timezone.localdate(),
        crowd_level="low",
        calculated_at=timezone.now(),
    )
    HistoricalRecord.objects.create(
        airport=flight.destination,
        date=timezone.localdate(),
        total_flights=1,
        seats_total=100,
        seats_booked=50,
    )
    for airport in (flight.origin, flight.destination):
        with pytest.raises(ProtectedError):
            airport.delete()


def test_forecast_creator_is_required_and_protected(flight_fields):
    fields = {
        "airport": flight_fields["origin"], "date": timezone.localdate(),
        "crowd_level": "low", "calculated_at": timezone.now(),
    }
    CrowdForecast.objects.create(**fields, created_by=flight_fields["created_by"])
    with pytest.raises(ProtectedError):
        flight_fields["created_by"].delete()
    with pytest.raises(IntegrityError), transaction.atomic():
        CrowdForecast.objects.create(**{**fields, "date": timezone.localdate() + timedelta(days=1)})


def test_head_cannot_remove_own_promoter_after_repromotion_cycle(
    client, head, make_user
):
    promoted = make_user("promoted", "head", promoted_by=head)
    authorize(client, head)
    assert (
        post(client, "heads/remove", email=head.email, role="staff").status_code == 200
    )
    authorize(client, promoted)
    assert post(client, "heads/promote", email=head.email).status_code == 200
    authorize(client, head)
    assert (
        post(client, "heads/remove", email=promoted.email, role="traveler").status_code
        == 403
    )
    promoted.refresh_from_db()
    assert promoted.role == "head"


def test_expired_and_inactive_tokens_cannot_authenticate_or_refresh(client, make_user):
    user = make_user("traveler")
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    access.set_exp(lifetime=timedelta(seconds=-1))
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    assert client.get("/api/accounts/profile/").status_code == 401
    refresh.set_exp(lifetime=timedelta(seconds=-1))
    assert post(client, "token/refresh", refresh=str(refresh)).status_code == 401
    active_refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {active_refresh.access_token}")
    user.is_active = False
    user.save(update_fields=["is_active"])
    assert client.get("/api/accounts/profile/").status_code == 401
    assert post(client, "token/refresh", refresh=str(active_refresh)).status_code == 401
