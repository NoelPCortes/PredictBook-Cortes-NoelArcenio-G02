from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import StaffAssignment, User

ACCOUNTS_URL = "/api/accounts/"
PASSWORD = "Account-Test-Password-92!"


class AccountFlowTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.traveler = User.objects.create_user(username="traveler", email="traveler@example.com", password=PASSWORD)
        cls.staff = User.objects.create_user(username="staff", email="staff@example.com", password=PASSWORD, role=User.Role.STAFF)
        cls.head = User.objects.create_user(username="head", email="head@example.com", password=PASSWORD, role=User.Role.HEAD)

    def setUp(self):
        self.signup = {"username": "new_traveler", "email": "new@example.com", "password": PASSWORD}

    def test_valid_signup_hashes_password_and_returns_safe_traveler_profile(self):
        response = self.client.post(f"{ACCOUNTS_URL}signup/", self.signup)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(set(response.data), {"id", "username", "email", "first_name", "last_name", "role"})
        self.assertEqual(response.data["role"], User.Role.TRAVELER)
        account = User.objects.get(pk=response.data["id"])
        self.assertTrue(account.check_password(PASSWORD))
        self.assertNotEqual(account.password, PASSWORD)

    def test_signup_applies_pending_staff_access_and_removes_assignment(self):
        StaffAssignment.objects.create(email=self.signup["email"], assigned_by=self.head)
        response = self.client.post(f"{ACCOUNTS_URL}signup/", self.signup)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["role"], User.Role.STAFF)
        self.assertFalse(StaffAssignment.objects.exists())

    def test_signup_rejects_case_insensitive_duplicates_and_weak_password(self):
        invalid = (
            ("username", self.traveler.username.upper()),
            ("email", self.traveler.email.upper()),
            ("password", "123"),
        )
        for field, value in invalid:
            with self.subTest(field=field):
                response = self.client.post(f"{ACCOUNTS_URL}signup/", {**self.signup, field: value})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)
        self.assertFalse(User.objects.filter(username=self.signup["username"]).exists())

    def test_signin_returns_role_for_each_landing_page(self):
        identities = (
            (self.traveler.username, self.traveler),
            (self.staff.email, self.staff),
            (self.head.username, self.head),
        )
        for identifier, account in identities:
            with self.subTest(role=account.role):
                response = self.client.post(f"{ACCOUNTS_URL}signin/", {"identifier": identifier, "password": PASSWORD})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(set(response.data), {"access", "refresh", "profile"})
                self.assertEqual(response.data["profile"]["role"], account.role)

    def test_signin_rejects_unknown_identity_and_bad_password_without_tokens(self):
        for identifier in ("unknown@example.com", self.traveler.username):
            with self.subTest(identifier=identifier):
                response = self.client.post(f"{ACCOUNTS_URL}signin/", {"identifier": identifier, "password": "incorrect"})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.data, {"detail": "Invalid username/email or password."})

    def test_logout_rejects_another_users_token_and_blacklists_own_refresh_token(self):
        refresh = RefreshToken.for_user(self.traveler)
        other_refresh = RefreshToken.for_user(self.staff)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
        logout = f"{ACCOUNTS_URL}logout/"
        self.assertEqual(self.client.post(logout, {"refresh": str(other_refresh)}).status_code, 403)
        response = self.client.post(logout, {"refresh": str(refresh)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"detail": "Signed out."})
        self.assertEqual(list(BlacklistedToken.objects.values_list("token__jti", flat=True)), [refresh["jti"]])
        self.assertEqual(self.client.post(f"{ACCOUNTS_URL}token/refresh/", {"refresh": str(refresh)}).status_code, 401)

    def test_profile_reads_and_updates_only_the_signed_in_user(self):
        self.client.force_authenticate(self.traveler)
        url = f"{ACCOUNTS_URL}profile/"
        self.assertEqual(self.client.get(url).data["id"], self.traveler.pk)
        self.assertEqual(self.client.get(f"{url}{self.staff.pk}/").status_code, 404)
        self.assertEqual(self.client.patch(url, {"id": self.staff.pk, "first_name": "Changed"}).status_code, 400)
        response = self.client.patch(url, {"first_name": "Ada", "username": "Traveler"})
        self.assertEqual(response.status_code, 200)
        self.traveler.refresh_from_db()
        self.staff.refresh_from_db()
        self.assertEqual((self.traveler.first_name, self.traveler.username), ("Ada", "Traveler"))
        self.assertEqual(self.staff.first_name, "")

    def test_profile_rejects_case_insensitive_username_and_email_duplicates(self):
        self.client.force_authenticate(self.traveler)
        for field in ("username", "email"):
            with self.subTest(field=field):
                response = self.client.patch(f"{ACCOUNTS_URL}profile/", {field: getattr(self.staff, field).upper()})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)

    def test_profile_rejects_role_and_promoted_by_changes(self):
        self.client.force_authenticate(self.traveler)
        response = self.client.patch(f"{ACCOUNTS_URL}profile/", {"role": "head", "promoted_by": self.head.pk})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.data), {"role", "promoted_by"})
        self.traveler.refresh_from_db()
        self.assertEqual(self.traveler.role, User.Role.TRAVELER)
        self.assertIsNone(self.traveler.promoted_by)

    def test_password_change_requires_current_password_and_saves_new_hash(self):
        self.client.force_authenticate(self.traveler)
        url = f"{ACCOUNTS_URL}password/change/"
        new_password = "New-Test-Password-28!"
        response = self.client.post(url, {"current_password": "incorrect", "new_password": new_password})
        self.assertEqual(response.status_code, 400)
        self.assertIn("current_password", response.data)
        response = self.client.post(url, {"current_password": PASSWORD, "new_password": new_password})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"detail": "Password changed."})
        self.traveler.refresh_from_db()
        self.assertTrue(self.traveler.check_password(new_password))
        self.assertNotEqual(self.traveler.password, new_password)
