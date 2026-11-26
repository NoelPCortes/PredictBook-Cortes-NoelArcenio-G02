from django.urls import path

from . import views

app_name = "accounts"

urlpatterns = [
    path("signup/", views.SignupView.as_view(), name="signup"),
    path("signin/", views.SigninView.as_view(), name="signin"),
    path("token/refresh/", views.RefreshView.as_view(), name="token_refresh"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("profile/", views.ProfileView.as_view(), name="profile"),
    path("head/", views.HeadAreaView.as_view(), name="head"),
    path(
        "password/change/", views.PasswordChangeView.as_view(), name="password_change"
    ),
    path("staff/assign/", views.AssignStaffView.as_view(), name="assign_staff"),
    path("staff/", views.StaffListView.as_view(), name="staff_list"),
    path("staff/<int:pk>/", views.StaffDetailView.as_view(), name="staff_detail"),
    path("heads/promote/", views.PromoteHeadView.as_view(), name="promote_head"),
    path("heads/remove/", views.RemoveHeadView.as_view(), name="remove_head"),
    path("staff/revoke/", views.RevokeStaffView.as_view(), name="revoke_staff"),
]
