import pytest

from app.gis.geo import haversine, point_segment_distance
from app.gis.routing import Barrier, GraphInputs, NoPathError, Weights, build_graph, candidate_routes, count_turns, estimate_materials

A = (30.3560, 76.3700)


def offset(dlat_m, dlon_m):
    return (A[0] + dlat_m / 111_320, A[1] + dlon_m / (111_320 * 0.8631))


def osm_square():
    """Two alternative paths between SW and NE corners of a 100 m square."""
    nodes = {1: offset(0, 0), 2: offset(100, 0), 3: offset(100, 100), 4: offset(0, 100)}
    elements = [{"type": "node", "id": k, "lat": v[0], "lon": v[1]} for k, v in nodes.items()]
    elements += [{"type": "way", "id": 10, "nodes": [1, 2, 3], "tags": {"highway": "footway"}},
                 {"type": "way", "id": 11, "nodes": [1, 4, 3], "tags": {"highway": "footway", "tactile_paving": "yes"}}]
    return {"elements": elements}, nodes


def test_haversine_and_segment_distance():
    assert haversine(*offset(0, 0), *offset(100, 0)) == pytest.approx(100, rel=0.01)
    assert point_segment_distance(offset(50, 10), offset(0, 0), offset(100, 0)) == pytest.approx(10, rel=0.05)


def test_route_follows_survey_track():
    track = [offset(i * 10, 0) for i in range(11)]
    w = Weights()
    routes = candidate_routes(build_graph(GraphInputs(track), w), track[0], track[-1], w)
    assert routes[0]["distance_m"] == pytest.approx(100, rel=0.02)
    assert routes[0]["score_breakdown"]["unverified_fraction"] == 0


def test_barrier_penalty_changes_preferred_route():
    osm, nodes = osm_square()
    w = Weights()
    base = candidate_routes(build_graph(GraphInputs([], osm=osm), w), nodes[1], nodes[3], w)
    assert len(base) == 2
    preferred = base[0]["geometry"]
    via_west = any(abs(p[0] - nodes[2][0]) < 1e-9 for p in preferred)
    blocked_corner = nodes[2] if via_west else nodes[4]
    barrier = Barrier(blocked_corner[0], blocked_corner[1], "pole", "survey")
    routes = candidate_routes(build_graph(GraphInputs([], barriers=[barrier], osm=osm), w), nodes[1], nodes[3], w)
    assert routes[0]["score_breakdown"]["barrier_count"] == 0
    assert routes[1]["score_breakdown"]["barrier_count"] == 1
    assert all(r["score_breakdown"]["unverified_fraction"] == 1.0 for r in routes)
    assert routes[0]["score_breakdown"]["missing_data"]


def test_impassable_policy_removes_edges():
    track = [offset(i * 10, 0) for i in range(5)]
    w = Weights(exclude_impassable=True)
    g = build_graph(GraphInputs(track, barriers=[Barrier(*track[2], "wall", "survey", impassable=True)]), w)
    with pytest.raises(NoPathError):
        candidate_routes(g, track[0], track[-1], w)


def test_empty_network_has_no_path():
    with pytest.raises(NoPathError):
        candidate_routes(build_graph(GraphInputs([]), Weights()), A, offset(100, 0), Weights())


def test_turns_and_material_estimate():
    pts = [offset(0, 0), offset(50, 0), offset(50, 50)]
    assert count_turns(pts) == 1
    m = estimate_materials(30.0, crossings=1, turns=1)
    assert m["directional_tiles"] == 105  # ceil(30/0.3)=100 * 1.05
    assert m["warning_bands"] == 5 and m["warning_tiles"] == 32
