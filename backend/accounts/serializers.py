from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.validators import UniqueValidator
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from . import services
from .models import StaffAssignment, User


class StrictFieldsMixin:
    def to_internal_value(self, request_fields):
        if isinstance(request_fields, dict):
            unknown = set(request_fields) - set(self.fields)
            readonly = {name for name, field in self.fields.items() if field.read_only}
            forbidden = unknown | (set(request_fields) & readonly)
            if forbidden:
                raise serializers.ValidationError(
                    {name: ["This field is not allowed."] for name in forbidden}
                )
        return super().to_internal_value(request_fields)


def check_password_validators(password: str, user: User, field: str) -> None:
    try:
        validate_password(password, user=user)
    except DjangoValidationError as error:
        raise serializers.ValidationError({field: error.messages}) from error


class UniqueIdentitySerializer(StrictFieldsMixin, serializers.ModelSerializer):
    def get_fields(self):
        fields = super().get_fields()
        for name in ("username", "email"):
            for validator in fields[name].validators:
                if isinstance(validator, UniqueValidator):
                    validator.lookup = "iexact"
        return fields


class ProfileSerializer(UniqueIdentitySerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email", "first_name", "last_name", "role")
        read_only_fields = ("id", "role")

    def update(self, instance, validated_data):
        return services.update_profile(instance, validated_data)


class SignupSerializer(UniqueIdentitySerializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    class Meta:
        model = User
        fields = ("username", "email", "password", "first_name", "last_name")

    def validate(self, attrs):
        candidate = User(
            **{key: value for key, value in attrs.items() if key != "password"}
        )
        check_password_validators(attrs["password"], candidate, "password")
        return attrs

    def create(self, validated_data):
        return services.register_user(validated_data)


class SigninSerializer(StrictFieldsMixin, serializers.Serializer):
    identifier = serializers.CharField(write_only=True)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        return services.sign_in(**attrs, request=self.context["request"])


class LogoutSerializer(StrictFieldsMixin, serializers.Serializer):
    refresh = serializers.CharField(write_only=True)

    def validate_refresh(self, value):
        try:
            token = RefreshToken(value)
        except TokenError as error:
            raise InvalidToken("Invalid or expired refresh token.") from error
        user_id = getattr(self.context["request"].user, api_settings.USER_ID_FIELD)
        if str(token.get(api_settings.USER_ID_CLAIM)) != str(user_id):
            raise PermissionDenied("Refresh token belongs to another account.")
        return token

    def save(self):
        self.validated_data["refresh"].blacklist()


class PasswordChangeSerializer(StrictFieldsMixin, serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError(
                {"current_password": ["Current password is incorrect."]}
            )
        check_password_validators(attrs["new_password"], user, "new_password")
        return attrs

    def save(self):
        services.change_password(self.context["request"].user, **self.validated_data)


class EmailSerializer(StrictFieldsMixin, serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class RemoveHeadSerializer(EmailSerializer):
    role = serializers.ChoiceField(choices=(User.Role.STAFF, User.Role.TRAVELER))


class StaffListSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email")


class StaffDetailSerializer(serializers.ModelSerializer):
    flights_created = serializers.IntegerField(read_only=True)
    forecasts_created = serializers.IntegerField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "date_joined",
            "flights_created",
            "forecasts_created",
        )


class PendingStaffSerializer(serializers.ModelSerializer):
    assigned_by_username = serializers.CharField(
        source="assigned_by.username", read_only=True
    )

    class Meta:
        model = StaffAssignment
        fields = ("email", "assigned_by_username", "assigned_at")
