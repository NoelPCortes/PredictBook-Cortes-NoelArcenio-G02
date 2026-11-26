from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import (
    AuthenticationFailed,
    PermissionDenied,
    ValidationError,
)
from rest_framework_simplejwt.tokens import RefreshToken

from .models import StaffAssignment, User

IDENTITY_CONSTRAINT_FIELDS = {
    "accounts_user_username_key": "username",
    "accounts_username_case_insensitive_unique": "username",
    "accounts_user_email_key": "email",
    "accounts_email_case_insensitive_unique": "email",
}
IDENTITY_DUPLICATE_MESSAGES = {
    "username": "A user with that username already exists.",
    "email": "user with this email already exists.",
}


def duplicate_identity_error(error):
    constraint = getattr(getattr(error.__cause__, "diag", None), "constraint_name", None)
    field = IDENTITY_CONSTRAINT_FIELDS.get(constraint)
    if field:
        return ValidationError({field: [IDENTITY_DUPLICATE_MESSAGES[field]]})
    return ValidationError("Username or email is already in use.")


def register_user(validated_fields: dict) -> User:
    try:
        with transaction.atomic():
            assignment = (
                StaffAssignment.objects.select_for_update()
                .filter(
                    email=validated_fields["email"],
                )
                .first()
            )
            role = User.Role.STAFF if assignment else User.Role.TRAVELER
            user = User.objects.create_user(**validated_fields, role=role)
            if assignment:
                assignment.delete()
            return user
    except IntegrityError as error:
        raise duplicate_identity_error(error) from error


def sign_in(identifier: str, password: str, request) -> dict:
    candidates = list(
        User.objects.filter(Q(username=identifier) | Q(email=identifier))[:2]
    )
    username = candidates[0].username if len(candidates) == 1 else identifier
    user = authenticate(request=request, username=username, password=password)
    if len(candidates) != 1 or user is None:
        raise AuthenticationFailed("Invalid username/email or password.")
    refresh = RefreshToken.for_user(user)
    update_last_login(None, user)
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": user}


@transaction.atomic
def update_profile(user: User, validated_fields: dict) -> User:
    locked_user = get_object_or_404(User.objects.select_for_update(), pk=user.pk)
    for field, value in validated_fields.items():
        setattr(locked_user, field, value)
    try:
        with transaction.atomic():
            locked_user.save()
    except IntegrityError as error:
        raise duplicate_identity_error(error) from error
    return locked_user


@transaction.atomic
def change_password(user: User, current_password: str, new_password: str) -> None:
    locked_user = get_object_or_404(User.objects.select_for_update(), pk=user.pk)
    if not locked_user.check_password(current_password):
        raise ValidationError({"current_password": ["Current password is incorrect."]})
    locked_user.set_password(new_password)
    locked_user.save(update_fields=["password"])


def lock_management_users(actor: User, email: str) -> tuple[User, User | None]:
    users = list(
        User.objects.select_for_update()
        .filter(Q(pk=actor.pk) | Q(email=email))
        .order_by("pk")
    )
    acting_head = next(user for user in users if user.pk == actor.pk)
    if not acting_head.is_active or acting_head.role != User.Role.HEAD:
        raise PermissionDenied("Head access is required.")
    target = next((user for user in users if user.email == email), None)
    return acting_head, target


@transaction.atomic
def assign_staff(actor: User, email: str) -> str:
    acting_head, target = lock_management_users(actor, email)
    if target:
        if target.role in (User.Role.STAFF, User.Role.HEAD):
            return "Account already has Staff or Head access; no change made."
        target.role = User.Role.STAFF
        target.promoted_by = None
        target.save(update_fields=["role", "promoted_by"])
        return "Staff access assigned."
    _, created = StaffAssignment.objects.get_or_create(
        email=email,
        defaults={"assigned_by": acting_head},
    )
    return (
        "Pending Staff access assigned."
        if created
        else "Staff assignment already pending."
    )


@transaction.atomic
def promote_head(actor: User, email: str) -> str:
    acting_head, target = lock_management_users(actor, email)
    if target is None:
        raise ValidationError({"email": ["A Staff account is required."]})
    if target.role != User.Role.STAFF:
        raise ValidationError("Only Staff members can be promoted to Head.")
    target.role = User.Role.HEAD
    target.promoted_by = acting_head
    target.save(update_fields=["role", "promoted_by"])
    return "Head access granted."


@transaction.atomic
def remove_head(actor: User, email: str, role: str) -> str:
    acting_head, target = lock_management_users(actor, email)
    if target is None or target.role != User.Role.HEAD:
        raise ValidationError("A Head account is required.")
    if target.pk != acting_head.pk:
        if target.pk == acting_head.promoted_by_id:
            raise PermissionDenied("You cannot remove the Head who promoted you.")
        if target.promoted_by_id != acting_head.pk:
            raise PermissionDenied(
                "You can only remove yourself or a Head you promoted."
            )
    target.role = role
    target.promoted_by = None
    target.save(update_fields=["role", "promoted_by"])
    return "Head access removed."


@transaction.atomic
def revoke_staff(actor: User, email: str) -> str:
    _, target = lock_management_users(actor, email)
    if target:
        if target.role != User.Role.STAFF:
            raise ValidationError("Only Staff access can be revoked here.")
        target.role = User.Role.TRAVELER
        target.promoted_by = None
        target.save(update_fields=["role", "promoted_by"])
        return "Staff access revoked."
    assignment = get_object_or_404(
        StaffAssignment.objects.select_for_update(),
        email=email,
    )
    assignment.delete()
    return "Pending Staff access revoked."
