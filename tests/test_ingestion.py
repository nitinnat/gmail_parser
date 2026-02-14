from datetime import datetime

from gmail_parser.ingestion import IngestionPipeline


def test_build_time_query_days_ago():
    query = IngestionPipeline.build_time_query(days_ago=30)
    assert query.startswith("after:")


def test_build_time_query_after_before():
    query = IngestionPipeline.build_time_query(
        after=datetime(2024, 1, 1),
        before=datetime(2024, 6, 30),
    )
    assert "after:" in query
    assert "before:" in query


def test_build_time_query_newer_older():
    query = IngestionPipeline.build_time_query(newer_than="30d", older_than="1y")
    assert "newer_than:30d" in query
    assert "older_than:1y" in query


def test_build_time_query_combined_with_text():
    query = IngestionPipeline.build_time_query(
        query="from:alice@example.com",
        days_ago=60,
    )
    assert query.startswith("from:alice@example.com ")
    assert "after:" in query


def test_build_time_query_empty():
    assert IngestionPipeline.build_time_query() == ""
