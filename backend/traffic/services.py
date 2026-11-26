from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404

from flights.models import Airport

from .calculation import CALCULATED_SOURCES, recalculate_forecasts
from .models import CrowdForecast


def save_forecast(serializer, **kwargs):
    try:
        with transaction.atomic():
            airport = serializer.validated_data.get(
                "airport", getattr(serializer.instance, "airport", None)
            )
            airport_ids = {airport.pk}
            if serializer.instance:
                airport_ids.add(serializer.instance.airport_id)
            list(
                Airport.objects.select_for_update()
                .filter(pk__in=airport_ids)
                .order_by("pk")
            )
            if serializer.instance:
                serializer.instance = get_object_or_404(
                    CrowdForecast.objects.select_for_update(), pk=serializer.instance.pk
                )
                if serializer.instance.data_source in CALCULATED_SOURCES:
                    serializer.validate_calculated_location(serializer.validated_data)
                    kwargs["data_source"] = "Staff entry"
                elif not serializer.instance.data_source and "data_source" not in serializer.validated_data:
                    kwargs["data_source"] = "Staff entry"
            return serializer.save(calculated_at=timezone.now(), **kwargs)
    except IntegrityError as error:
        constraint = getattr(
            getattr(error.__cause__, "diag", None), "constraint_name", None
        )
        if constraint == "forecast_unique_airport_date":
            raise ValidationError(
                {"date": ["A forecast already exists for this airport and date."]}
            ) from None
        raise


@transaction.atomic
def delete_forecast(forecast, actor):
    get_object_or_404(Airport.objects.select_for_update(), pk=forecast.airport_id)
    current = get_object_or_404(
        CrowdForecast.objects.select_for_update(), pk=forecast.pk, airport_id=forecast.airport_id
    )
    if current.data_source in CALCULATED_SOURCES:
        raise PermissionDenied("Calculated forecasts cannot be deleted.")
    pair = (current.airport_id, current.date)
    current.delete()
    recalculate_forecasts(actor, {pair})
