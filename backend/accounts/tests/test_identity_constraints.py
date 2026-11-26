from unittest.mock import patch

from rest_framework.test import APITestCase
from rest_framework.validators import UniqueValidator

from accounts.models import User


class IdentityConstraintTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.existing = User.objects.create(username="ExistingUser", email="Existing@example.com")
        cls.actor = User.objects.create(username="AccountUser", email="Account@example.com")

    def test_database_race_on_signup_returns_existing_field_duplicate_messages(self):
        payload = {"username": "NewAccount", "email": "New@example.com", "password": "Orbit-bicycle-72!"}
        for field, message in (
            ("username", "A user with that username already exists."),
            ("email", "user with this email already exists."),
        ):
            with self.subTest(field=field), patch.object(UniqueValidator, "__call__", return_value=None):
                response = self.client.post("/api/accounts/signup/", {**payload, field: getattr(self.existing, field).upper()})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data[field], [message])
        self.assertEqual(User.objects.count(), 2)

    def test_database_race_on_profile_update_returns_the_conflicting_field(self):
        self.client.force_authenticate(self.actor)
        with patch.object(UniqueValidator, "__call__", return_value=None):
            response = self.client.patch("/api/accounts/profile/", {"username": "existinguser", "first_name": "Changed"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["username"], ["A user with that username already exists."])
        self.actor.refresh_from_db()
        self.assertEqual(self.actor.username, "AccountUser")
        self.assertEqual(self.actor.first_name, "")
