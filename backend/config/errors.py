import logging

from django.http import HttpResponse, JsonResponse
from rest_framework import status
from rest_framework.views import exception_handler, set_rollback

logger = logging.getLogger(__name__)
SERVER_ERROR = "Something went wrong."


def error_response(request, message, status_code):
    if request.path_info.startswith("/api/"):
        return JsonResponse({"detail": message}, status=status_code)
    return HttpResponse(
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        f"<title>{message}</title><main><h1>{message}</h1></main></html>",
        status=status_code,
    )


def bad_request(request, exception):
    return error_response(request, "Bad request.", 400)


def permission_denied(request, exception):
    return error_response(request, "Permission denied.", 403)


def not_found(request, exception):
    return error_response(request, "Not found.", 404)


def server_error(request):
    return error_response(request, SERVER_ERROR, 500)


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        if response.status_code == status.HTTP_404_NOT_FOUND:
            return JsonResponse(response.data, status=response.status_code, safe=False)
        return response
    logger.error("Unhandled API exception", exc_info=exc)
    set_rollback()
    return JsonResponse({"detail": SERVER_ERROR}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
