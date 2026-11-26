from django.db.models import CharField, Q
from django.db.models.functions import Cast
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from flights.models import Airport

from .calculation import CALCULATED_SOURCES, SAMPLE_SOURCE, flight_totals
from .insights import date_explanation, date_recommendations
from .models import CrowdForecast
from .permissions import CanManageForecasts
from .serializers import (
    DateInsightFilterSerializer,
    ForecastFilterSerializer,
    ForecastSerializer,
    RecommendationFilterSerializer,
)
from .services import delete_forecast, save_forecast


class ForecastListCreateView(generics.ListCreateAPIView):
    permission_classes = (IsAuthenticated, CanManageForecasts)
    serializer_class = ForecastSerializer

    def get_queryset(self):
        filters = ForecastFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        values = filters.validated_data
        forecasts = CrowdForecast.objects.select_related("airport", "created_by")
        if values.get("search"):
            forecasts = forecasts.annotate(date_text=Cast("date", CharField())).filter(
                Q(airport__code__icontains=values["search"])
                | Q(airport__name__icontains=values["search"])
                | Q(airport__city__icontains=values["search"])
                | Q(date_text__icontains=values["search"])
            )
        if "level" in values:
            forecasts = forecasts.filter(crowd_level=values["level"])
        if values.get("source") == "calculated":
            forecasts = forecasts.filter(data_source__in=CALCULATED_SOURCES)
        elif values.get("source") == "manual":
            forecasts = forecasts.exclude(
                data_source__in=(*CALCULATED_SOURCES, SAMPLE_SOURCE)
            )
        if "airport" in values:
            forecasts = forecasts.filter(airport=values["airport"])
        if "month" in values:
            month = values["month"]
            forecasts = forecasts.filter(date__year=month.year, date__month=month.month)
        if values.get("mine"):
            forecasts = forecasts.filter(created_by=self.request.user)
        return forecasts.order_by("date", "airport__code", "pk")

    def perform_create(self, serializer):
        save_forecast(serializer, created_by=self.request.user)

    def get_serializer(self, *args, **kwargs):
        if kwargs.get("many"):
            args = (list(args[0]), *args[1:])
            context = self.get_serializer_context()
            context["flight_totals"] = flight_totals(
                {(item.airport_id, item.date) for item in args[0]}
            )
            kwargs["context"] = context
        return super().get_serializer(*args, **kwargs)


class ForecastDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = (IsAuthenticated, CanManageForecasts)
    serializer_class = ForecastSerializer
    queryset = CrowdForecast.objects.select_related("airport", "created_by")
    http_method_names = ("get", "patch", "delete", "head", "options")

    def perform_update(self, serializer):
        save_forecast(serializer)

    def perform_destroy(self, instance):
        delete_forecast(instance, self.request.user)


class DateExplanationView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        filters = DateInsightFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        airport = get_object_or_404(Airport, pk=filters.validated_data["airport"])
        return Response(date_explanation(airport, filters.validated_data["date"]))


class DateRecommendationsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        filters = RecommendationFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        airport = get_object_or_404(Airport, pk=filters.validated_data["airport"])
        destination_id = filters.validated_data.get("destination")
        destination = get_object_or_404(Airport, pk=destination_id) if destination_id else None
        return Response(date_recommendations(airport, filters.validated_data["date"], destination))
