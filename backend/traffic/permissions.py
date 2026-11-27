from rest_framework.permissions import SAFE_METHODS

from accounts.permissions import IsStaffOrHead


class CanManageForecasts(IsStaffOrHead):
    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or super().has_permission(request, view)
