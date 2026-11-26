from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.functions import Upper


class User(AbstractUser):
    class Role(models.TextChoices):
        TRAVELER = "traveler", "Traveler"
        STAFF = "staff", "Staff"
        HEAD = "head", "Head"

    email = models.EmailField(unique=True)
    role = models.CharField(max_length=8, choices=Role.choices, default=Role.TRAVELER)
    promoted_by = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="promoted_heads",
    )

    class Meta(AbstractUser.Meta):
        constraints = (
            models.UniqueConstraint(Upper("username"), name="accounts_username_case_insensitive_unique"),
            models.UniqueConstraint(Upper("email"), name="accounts_email_case_insensitive_unique"),
        )


class StaffAssignment(models.Model):
    email = models.EmailField(unique=True)
    assigned_by = models.ForeignKey(User, on_delete=models.PROTECT)
    assigned_at = models.DateTimeField(auto_now_add=True)
