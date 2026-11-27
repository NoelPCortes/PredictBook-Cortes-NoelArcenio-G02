from collections import defaultdict
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import Q
from django.utils.timezone import now

from flights.models import Flight

from .calculation import (
    FLIGHT_WEIGHT,
    HIGH_THRESHOLD,
    HISTORY_WEIGHT,
    MAX_RECOMMENDATIONS,
    MEDIUM_THRESHOLD,
    RECOMMENDATION_WINDOW,
    calculate_pairs,
    percentage,
    rounded,
)
from .models import CrowdForecast

MANILA_TIME_ZONE = ZoneInfo("Asia/Manila")


def date_label(date):
    return f"{date:%b} {date.day}, {date.year}"


def date_explanation(airport, date):
    data = calculate_pairs({(airport.pk, date)})[(airport.pk, date)]
    flights = data["flights"]
    occupancy = rounded(data["occupancy"]) if data["occupancy"] is not None else None
    average = (
        rounded(data["history_average"])
        if data["history_average"] is not None
        else None
    )
    records = [
        {
            "date": row["date"].isoformat(),
            "weekday": row["date"].strftime("%A"),
            "seats_booked": row["seats_booked"],
            "seats_total": row["seats_total"],
            "occupancy_percent": rounded(
                percentage(row["seats_booked"], row["seats_total"])
            ),
        }
        for row in data["records"]
    ]
    sentences = []
    if occupancy is not None:
        sentences.append(
            f"{flights['flight_count']} flights are scheduled for {date:%A}, {date_label(date)}: "
            f"{flights['seats_booked']} of {flights['seats_total']} seats are booked ({occupancy:.1f}%)."
        )
    if average is not None:
        sentences.append(
            f"In 2025, the same weekday around this date averaged {average:.1f}% of seats booked."
        )
    elif data["has_data"]:
        sentences.append(
            f"No 2025 history is available for this date, so the score uses {date.year} flights only."
        )
    if data["has_data"]:
        sentences.append(
            f"The combined score is {data['crowd_score']:.1f}, which is {data['crowd_level'].title()} "
            "(below 50 is Low, 50 to 74.9 is Medium, 75 and above is High)."
        )
    if flights["departing_count"]:
        sentences.append(
            f"{flights['open_seats']} seats are open on {flights['departing_count']} departing flights."
        )
    return {
        "airport": {"id": airport.pk, "code": airport.code, "name": airport.name},
        "date": date.isoformat(),
        "weekday": date.strftime("%A"),
        "has_data": data["has_data"],
        "flights": {
            "count": flights["flight_count"],
            "departing_count": flights["departing_count"],
            "arriving_count": flights["arriving_count"],
            "seats_total": flights["seats_total"],
            "seats_booked": flights["seats_booked"],
            "occupancy_percent": occupancy,
        },
        "history": {
            "used_dates": [row["date"] for row in records],
            "records": records,
            "average_occupancy_percent": average,
        },
        "weights": {
            "flights": int(FLIGHT_WEIGHT * 100),
            "history": int(HISTORY_WEIGHT * 100),
        },
        "thresholds": {"medium_from": MEDIUM_THRESHOLD, "high_from": HIGH_THRESHOLD},
        "crowd_score": data["crowd_score"],
        "crowd_level": data["crowd_level"],
        "history_available": average is not None,
        "open_seats": flights["open_seats"],
        "sentences": sentences,
    }


def selected_flight_status(flights, current_time):
    if not flights:
        return {"state": "no_flights", "message": "No flights are scheduled for this date."}
    upcoming = [flight for flight in flights if flight.departure_time > current_time]
    if not upcoming:
        return {"state": "departed", "message": "All flights on this date have already departed."}
    if not any(flight.available_seats > 0 for flight in upcoming):
        return {"state": "full", "message": "All flights on this date are full."}
    return {"state": "bookable", "message": ""}


def recommendation_history_average(records):
    occupancy = [
        percentage(row["seats_booked"], row["seats_total"])
        for row in records
        if row["date"].year == 2025
    ]
    return rounded(sum(occupancy) / len(occupancy)) if occupancy else None


def recommendation_message(result, selected_date, scheduled_flights):
    if len(result) == MAX_RECOMMENDATIONS:
        return ""
    if result:
        dates = "date is" if len(result) == 1 else "dates are"
        return f"Only {len(result)} qualifying {dates} available within {RECOMMENDATION_WINDOW} days of {selected_date}."
    message = f"No flights with open seats were found within {RECOMMENDATION_WINDOW} days of {selected_date}."
    last_departure = scheduled_flights.order_by("-departure_time").values_list("departure_time", flat=True).first()
    if last_departure:
        last_date = last_departure.astimezone(MANILA_TIME_ZONE).date()
        if selected_date > last_date:
            message += f" Scheduled flights end on {last_date}."
    return message


def date_recommendations(airport, selected_date, destination=None):
    start_date = selected_date - timedelta(days=RECOMMENDATION_WINDOW)
    end_date = selected_date + timedelta(days=RECOMMENDATION_WINDOW)
    current_time = now().astimezone(MANILA_TIME_ZONE)
    forecasts = {
        row.date: row
        for row in CrowdForecast.objects.filter(
            airport=airport, date__range=(start_date, end_date)
        )
    }
    selected = forecasts.get(selected_date)
    selected_score = selected.crowd_score if selected else None
    calculations = calculate_pairs(
        {(airport.pk, date) for date in {*forecasts, selected_date}}
    )
    scheduled_flights = Flight.objects.filter(origin=airport)
    if destination:
        scheduled_flights = scheduled_flights.filter(destination=destination)
    selected_start = datetime.combine(selected_date, time.min, tzinfo=MANILA_TIME_ZONE)
    flights = (
        scheduled_flights.filter(
            departure_time__gte=datetime.combine(start_date, time.min, tzinfo=MANILA_TIME_ZONE),
            departure_time__lt=datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=MANILA_TIME_ZONE),
        )
        .filter(
            Q(departure_time__gt=current_time, available_seats__gt=0)
            | Q(departure_time__gte=selected_start, departure_time__lt=selected_start + timedelta(days=1))
        )
        .select_related("airline", "origin", "destination")
        .order_by("departure_time", "pk")
    )
    departures = defaultdict(list)
    for flight in flights:
        departures[flight.departure_time.astimezone(MANILA_TIME_ZONE).date()].append(flight)
    candidates = []
    for date, forecast in forecasts.items():
        if date == selected_date or forecast.crowd_level not in ("low", "medium") or not departures[date]:
            continue
        data = calculations[(airport.pk, date)]
        average = recommendation_history_average(data["records"])
        score = forecast.crowd_score if forecast.crowd_score is not None else average
        if score is None:
            continue
        qualifying = departures[date]
        open_seats = sum(flight.available_seats for flight in qualifying)
        count = len(qualifying)
        difference = rounded(str(selected_score - score)) if selected_score is not None else None
        reasons = [
            f"This day has a Low crowd level (score {score:.1f})."
            if forecast.crowd_level == "low"
            else f"This day has a Medium crowd level, moderate congestion (score {score:.1f})."
        ]
        if destination:
            reasons.append(f"{count} flights from {airport.code} to {destination.code} depart on this date, with {open_seats} open seats.")
        else:
            reasons.append(f"{count} flights depart from {airport.code} on this date, with {open_seats} open seats.")
        if average is not None:
            reasons.append(f"In 2025, the same weekday around this date averaged {average:.1f}% seats booked.")
        candidates.append({
            "date": date.isoformat(),
            "weekday": date.strftime("%A"),
            "crowd_level": forecast.crowd_level,
            "crowd_score": score,
            "score_difference": difference,
            "open_seats": open_seats,
            "flight_count": count,
            "history_average_occupancy_percent": average,
            "reasons": reasons,
            "flights": [{
                "airline_name": flight.airline.name,
                "airline_code": flight.airline.code,
                "flight_number": flight.flight_number,
                "origin_code": flight.origin.code,
                "destination_code": flight.destination.code,
                "departure_time": flight.departure_time,
                "available_seats": flight.available_seats,
            } for flight in qualifying[:2]],
        })
    candidates.sort(key=lambda row: (row["crowd_level"] != "low", row["crowd_score"], -row["open_seats"], row["date"]))
    result = candidates[:MAX_RECOMMENDATIONS]
    return {
        "selected": {
            "date": selected_date.isoformat(),
            "has_data": selected is not None,
            "crowd_score": selected_score,
            "crowd_level": selected.crowd_level if selected else None,
        },
        "selected_status": selected_flight_status(departures[selected_date], current_time),
        "route": {"origin_code": airport.code, "destination_code": destination.code} if destination else None,
        "recommendations": result,
        "message": recommendation_message(result, selected_date, scheduled_flights),
    }
