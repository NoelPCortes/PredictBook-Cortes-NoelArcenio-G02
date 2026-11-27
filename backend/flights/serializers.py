from datetime import date

from django.utils.timezone import now
from rest_framework import serializers

from accounts.models import User
from accounts.serializers import StrictFieldsMixin

from .models import (
    FLIGHT_NUMBER_ERROR,
    FLIGHT_NUMBER_VALIDATOR,
    TOTAL_SEATS_ERROR,
    TOTAL_SEATS_VALIDATORS,
    Airline,
    Airport,
    Flight,
)
from .permissions import can_edit_record


class AirportSerializer(serializers.ModelSerializer):
    forecast_count = serializers.IntegerField(read_only=True)
    class Meta:
        model = Airport
        fields = ("id", "code", "name", "city", "country", "forecast_count")


class AirlineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Airline
        fields = ("id", "name", "code")


class FlightNumberField(serializers.CharField):
    def to_internal_value(self, data):
        return super().to_internal_value(data).upper()


class FlightSerializer(StrictFieldsMixin, serializers.ModelSerializer):
    flight_number = FlightNumberField(
        validators=[FLIGHT_NUMBER_VALIDATOR],
        error_messages={"blank": FLIGHT_NUMBER_ERROR, "invalid": FLIGHT_NUMBER_ERROR},
    )
    total_seats = serializers.IntegerField(
        validators=TOTAL_SEATS_VALIDATORS,
        error_messages={"invalid": TOTAL_SEATS_ERROR},
    )
    airline_name = serializers.CharField(source="airline.name", read_only=True)
    airline_code = serializers.CharField(source="airline.code", read_only=True)
    origin_code = serializers.CharField(source="origin.code", read_only=True)
    origin_name = serializers.CharField(source="origin.name", read_only=True)
    destination_code = serializers.CharField(source="destination.code", read_only=True)
    destination_name = serializers.CharField(source="destination.name", read_only=True)
    created_by_username = serializers.CharField(
        source="created_by.username", read_only=True
    )
    can_edit = serializers.SerializerMethodField()
    direction = serializers.SerializerMethodField()

    class Meta:
        model = Flight
        fields = (
            "id",
            "airline",
            "airline_name",
            "airline_code",
            "flight_number",
            "origin",
            "origin_code",
            "origin_name",
            "destination",
            "destination_code",
            "destination_name",
            "departure_time",
            "arrival_time",
            "total_seats",
            "available_seats",
            "created_by_username",
            "can_edit",
            "direction",
        )
        read_only_fields = ("id",)
        validators = ()

    def get_fields(self):
        fields = super().get_fields()
        if not self.context["request"].query_params.get("airport"):
            fields.pop("direction")
        if self.context["request"].user.role == User.Role.TRAVELER:
            fields.pop("created_by_username")
            fields.pop("can_edit")
        return fields

    def get_can_edit(self, obj):
        return can_edit_record(self.context["request"].user, obj)

    def get_direction(self, obj):
        return (
            "departing"
            if str(obj.origin_id) == self.context["request"].query_params.get("airport")
            else "arriving"
        )

    def departure_error(self, departure):
        if departure is None or (self.instance and departure == self.instance.departure_time):
            return None
        return "Departure cannot be in the past." if departure < now() else None

    def validate(self, attrs):
        current = self.instance

        def value(name):
            return attrs[name] if name in attrs else getattr(current, name, None)

        errors = {}
        departure_error = self.departure_error(attrs.get("departure_time"))
        if departure_error:
            errors["departure_time"] = [departure_error]
        for field in ("departure_time", "arrival_time"):
            if field in attrs and attrs[field].date() == date.max:
                errors[field] = ["Enter a valid date and time."]
        if value("origin") == value("destination"):
            errors["destination"] = ["Origin and destination must be different."]
        if value("arrival_time") <= value("departure_time"):
            errors["arrival_time"] = ["Arrival must be after departure."]
        if not 0 <= value("available_seats") <= value("total_seats"):
            errors["available_seats"] = [
                "Available seats must be between 0 and total seats."
            ]
        duplicates = Flight.objects.filter(
            airline=value("airline"),
            flight_number=value("flight_number"),
            departure_time=value("departure_time"),
        )
        if current:
            duplicates = duplicates.exclude(pk=current.pk)
        if duplicates.exists():
            errors["flight_number"] = [
                "This airline, flight number, and departure time already exist."
            ]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class FlightCalendarDateField(serializers.DateField):
    def to_internal_value(self, value):
        parsed = super().to_internal_value(value)
        if parsed in (date.min, date.max):
            raise serializers.ValidationError("Enter a valid date.")
        return parsed


class FlightFilterSerializer(serializers.Serializer):
    departure_date = FlightCalendarDateField(required=False, input_formats=("%Y-%m-%d",))
    arrival_date = FlightCalendarDateField(required=False, input_formats=("%Y-%m-%d",))
    departure_hour_from = serializers.RegexField(r"^(?:[0-9]|1[0-9]|2[0-3])$", required=False)
    departure_hour_to = serializers.RegexField(r"^(?:[0-9]|1[0-9]|2[0-3])$", required=False)
    arrival_hour_from = serializers.RegexField(r"^(?:[0-9]|1[0-9]|2[0-3])$", required=False)
    arrival_hour_to = serializers.RegexField(r"^(?:[0-9]|1[0-9]|2[0-3])$", required=False)
    destination = serializers.PrimaryKeyRelatedField(
        queryset=Airport.objects.all(), required=False
    )
    airline = serializers.PrimaryKeyRelatedField(
        queryset=Airline.objects.all(), required=False
    )
    search = serializers.CharField(required=False, allow_blank=True)
    upcoming = serializers.BooleanField(required=False)
    airport = serializers.PrimaryKeyRelatedField(
        queryset=Airport.objects.all(), required=False
    )
    origin = serializers.PrimaryKeyRelatedField(
        queryset=Airport.objects.all(), required=False
    )
    date = FlightCalendarDateField(required=False, input_formats=("%Y-%m-%d",))
    mine = serializers.BooleanField(required=False)

    def validate(self, attrs):
        errors = {}
        for prefix in ("departure", "arrival"):
            start = attrs.get(f"{prefix}_hour_from")
            end = attrs.get(f"{prefix}_hour_to")
            if start is not None and end is not None and int(end) < int(start):
                errors[f"{prefix}_hour_to"] = [
                    "The ending hour cannot be earlier than the starting hour."
                ]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class RouteDatesFilterSerializer(serializers.Serializer):
    origin = serializers.IntegerField(min_value=1)
    destination = serializers.IntegerField(min_value=1)
    month = serializers.RegexField(r"^\d{4}-\d{2}$")

    def validate_month(self, value):
        try:
            month = date.fromisoformat(f"{value}-01")
            if month == date(date.max.year, 12, 1):
                raise ValueError
            return month
        except ValueError:
            raise serializers.ValidationError(
                "Enter a valid month in YYYY-MM format."
            ) from None

    def validate(self, attrs):
        if attrs["origin"] == attrs["destination"]:
            raise serializers.ValidationError(
                {"destination": ["Origin and destination must be different."]}
            )
        return attrs
