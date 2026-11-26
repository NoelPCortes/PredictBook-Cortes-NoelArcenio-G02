from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

CROWD_SCORE_ERROR = "Enter a score from 0 to 100."


def validate_crowd_score(value):
    if not 0 <= value <= 100:
        raise ValidationError(CROWD_SCORE_ERROR)


class CrowdForecast(models.Model):
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    class CrowdLevel(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    airport = models.ForeignKey("flights.Airport", on_delete=models.PROTECT)
    date = models.DateField()
    crowd_level = models.CharField(max_length=6, choices=CrowdLevel.choices)
    crowd_score = models.FloatField(null=True, blank=True)
    calculated_at = models.DateTimeField()
    data_source = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        constraints = (
            models.UniqueConstraint(
                fields=["airport", "date"],
                name="forecast_unique_airport_date",
            ),
        )


class HistoricalRecord(models.Model):
    airport = models.ForeignKey("flights.Airport", on_delete=models.PROTECT)
    date = models.DateField()
    total_flights = models.PositiveIntegerField()
    seats_total = models.PositiveIntegerField()
    seats_booked = models.PositiveIntegerField()

    class Meta:
        constraints = (
            models.UniqueConstraint(
                fields=["airport", "date"],
                name="history_unique_airport_date",
            ),
        )
