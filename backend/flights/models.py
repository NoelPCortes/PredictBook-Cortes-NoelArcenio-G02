from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models

FLIGHT_NUMBER_ERROR = "Use 2 to 10 letters or digits."
FLIGHT_NUMBER_VALIDATOR = RegexValidator(r"\A[A-Z0-9]{2,10}\Z", FLIGHT_NUMBER_ERROR)
TOTAL_SEATS_ERROR = "Enter a number from 1 to 1000."
TOTAL_SEATS_VALIDATORS = (
    MinValueValidator(1, TOTAL_SEATS_ERROR),
    MaxValueValidator(1000, TOTAL_SEATS_ERROR),
)


class Airport(models.Model):
    code = models.CharField(max_length=3, unique=True)
    name = models.CharField(max_length=150)
    city = models.CharField(max_length=100)
    country = models.CharField(max_length=100)


class Airline(models.Model):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=10, unique=True)


class Flight(models.Model):
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    airline = models.ForeignKey(Airline, on_delete=models.PROTECT)
    flight_number = models.CharField(max_length=10)
    origin = models.ForeignKey(
        Airport,
        on_delete=models.PROTECT,
        related_name="departing_flights",
    )
    destination = models.ForeignKey(
        Airport,
        on_delete=models.PROTECT,
        related_name="arriving_flights",
    )
    departure_time = models.DateTimeField()
    arrival_time = models.DateTimeField()
    total_seats = models.PositiveIntegerField()
    available_seats = models.PositiveIntegerField()

    class Meta:
        indexes = (
            models.Index(fields=["departure_time"], name="flight_departure_idx"),
            models.Index(fields=["origin", "departure_time"], name="flight_origin_departure_idx"),
            models.Index(fields=["destination", "arrival_time"], name="flight_dest_arrival_idx"),
        )
        constraints = (
            models.CheckConstraint(
                condition=~models.Q(origin=models.F("destination")),
                name="flight_distinct_airports",
            ),
            models.CheckConstraint(
                condition=models.Q(arrival_time__gt=models.F("departure_time")),
                name="flight_arrival_after_departure",
            ),
            models.CheckConstraint(
                condition=models.Q(available_seats__gte=0)
                & models.Q(available_seats__lte=models.F("total_seats")),
                name="flight_available_seats_in_range",
            ),
            models.UniqueConstraint(
                fields=["airline", "flight_number", "departure_time"],
                name="flight_unique_airline_number_departure",
            ),
        )
