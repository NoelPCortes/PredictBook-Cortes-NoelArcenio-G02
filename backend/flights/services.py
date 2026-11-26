from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404

from traffic.calculation import flight_pairs, recalculate_forecasts

from .models import Airport, Flight

FLIGHT_CONSTRAINT_ERRORS = {
    "flight_distinct_airports": {
        "destination": ["Origin and destination must be different."],
    },
    "flight_arrival_after_departure": {
        "arrival_time": ["Arrival must be after departure."],
    },
    "flight_available_seats_in_range": {
        "available_seats": ["Available seats must be between 0 and total seats."],
    },
    "flight_unique_airline_number_departure": {
        "flight_number": [
            "This airline, flight number, and departure time already exist."
        ],
    },
}


def save_flight(serializer, **kwargs):
    try:
        with transaction.atomic():
            old_pairs = set()
            if serializer.instance:
                serializer.instance = get_object_or_404(
                    Flight.objects.select_for_update(), pk=serializer.instance.pk
                )
                old_pairs = flight_pairs(serializer.instance)
            fields = serializer.validated_data
            if serializer.instance:
                departure_error = serializer.departure_error(fields.get("departure_time"))
                if departure_error:
                    raise ValidationError({"departure_time": [departure_error]})
            airport_ids = {
                fields.get(name, getattr(serializer.instance, name, None)).pk
                for name in ("origin", "destination")
            }
            airport_ids.update(airport for airport, _ in old_pairs)
            list(
                Airport.objects.select_for_update()
                .filter(pk__in=airport_ids)
                .order_by("pk")
            )
            flight = serializer.save(**kwargs)
            actor = serializer.context["request"].user
            recalculate_forecasts(actor, old_pairs | flight_pairs(flight))
            return flight
    except IntegrityError as error:
        constraint = getattr(
            getattr(error.__cause__, "diag", None), "constraint_name", None
        )
        if constraint in FLIGHT_CONSTRAINT_ERRORS:
            raise ValidationError(FLIGHT_CONSTRAINT_ERRORS[constraint]) from None
        raise


@transaction.atomic
def delete_flight(flight, actor):
    flight = get_object_or_404(Flight.objects.select_for_update(), pk=flight.pk)
    pairs = flight_pairs(flight)
    list(
        Airport.objects.select_for_update()
        .filter(pk__in={airport for airport, _ in pairs})
        .order_by("pk")
    )
    flight.delete()
    recalculate_forecasts(actor, pairs)
