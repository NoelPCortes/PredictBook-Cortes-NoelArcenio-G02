from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from config.pagination import ListPagination
from flights.models import Flight
from traffic.models import CrowdForecast

from . import services
from .models import StaffAssignment, User
from .permissions import IsHead
from .serializers import (
    EmailSerializer,
    LogoutSerializer,
    PasswordChangeSerializer,
    PendingStaffSerializer,
    ProfileSerializer,
    RemoveHeadSerializer,
    SigninSerializer,
    SignupSerializer,
    StaffDetailSerializer,
    StaffListSerializer,
)


class SignupView(generics.GenericAPIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)
    serializer_class = SignupSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(ProfileSerializer(user).data, status=status.HTTP_201_CREATED)


class SigninView(generics.GenericAPIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)
    serializer_class = SigninSerializer

    def get_authenticate_header(self, request):
        return "Bearer"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.validated_data
        return Response(
            {
                "access": result["access"],
                "refresh": result["refresh"],
                "profile": ProfileSerializer(result["user"]).data,
            }
        )


class RefreshView(TokenRefreshView):
    permission_classes = (AllowAny,)


class LogoutView(generics.GenericAPIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = LogoutSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Signed out."})


class ProfileView(generics.RetrieveUpdateAPIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = ProfileSerializer
    http_method_names = ("get", "patch", "head", "options")

    def get_object(self):
        return self.request.user


class PasswordChangeView(generics.GenericAPIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = PasswordChangeSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Password changed."})


class HeadAreaView(APIView):
    permission_classes = (IsAuthenticated, IsHead)

    def get(self, request):
        return Response({"detail": "Head management access granted."})


class HeadManagementView(APIView):
    permission_classes = (
        IsAuthenticated,
        IsHead,
    )
    serializer_class = EmailSerializer

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        detail = self.perform_action(request.user, **serializer.validated_data)
        return Response({"detail": detail})


class AssignStaffView(HeadManagementView):
    perform_action = staticmethod(services.assign_staff)


class PromoteHeadView(HeadManagementView):
    perform_action = staticmethod(services.promote_head)


class RemoveHeadView(HeadManagementView):
    serializer_class = RemoveHeadSerializer
    perform_action = staticmethod(services.remove_head)


class RevokeStaffView(HeadManagementView):
    perform_action = staticmethod(services.revoke_staff)


class StaffListView(APIView):
    permission_classes = (IsAuthenticated, IsHead)

    def get(self, request):
        staff = User.objects.filter(role=User.Role.STAFF).order_by("username")
        if request.query_params.get("search"):
            term = request.query_params["search"]
            staff = staff.filter(Q(username__icontains=term) | Q(email__icontains=term))
        pending = StaffAssignment.objects.select_related("assigned_by").order_by(
            "email"
        )
        collections = {}
        for name, queryset, serializer in (
            ("staff", staff, StaffListSerializer),
            ("pending", pending, PendingStaffSerializer),
        ):
            paginator = ListPagination()
            paginator.page_query_param = f"{name}_page"
            page = paginator.paginate_queryset(queryset, request, view=self)
            collections[name] = paginator.get_paginated_response(
                serializer(page, many=True).data
            ).data
        return Response(collections)


class StaffDetailView(generics.RetrieveAPIView):
    permission_classes = (IsAuthenticated, IsHead)
    serializer_class = StaffDetailSerializer

    def get_queryset(self):
        flights = (
            Flight.objects.filter(created_by=OuterRef("pk"))
            .order_by()
            .values("created_by")
            .annotate(total=Count("pk"))
            .values("total")
        )
        forecasts = (
            CrowdForecast.objects.filter(created_by=OuterRef("pk"))
            .order_by()
            .values("created_by")
            .annotate(total=Count("pk"))
            .values("total")
        )
        return User.objects.filter(role=User.Role.STAFF).annotate(
            flights_created=Coalesce(Subquery(flights), 0),
            forecasts_created=Coalesce(Subquery(forecasts), 0),
        )
