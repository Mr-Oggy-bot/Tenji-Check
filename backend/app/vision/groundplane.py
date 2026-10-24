"""Flat-ground camera model: maps image pixels to a bird's-eye grid in metres and back.

Assumes a pinhole camera at a known height, pitched down by a known angle, with no roll, looking at flat ground.
Pitch comes from the phone's orientation sensor when available, otherwise from the user. Distances are therefore
estimates: a 5 degree pitch error moves a point 5 m ahead by roughly 1 m.
"""
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class Camera:
    width: int
    height: int
    hfov_deg: float = 63.0  # horizontal field of view of the frame as delivered
    pitch_deg: float = 40.0  # downward tilt of the optical axis from horizontal
    height_m: float = 1.4

    @property
    def f(self) -> float:
        return (self.width / 2) / np.tan(np.radians(self.hfov_deg) / 2)

    @property
    def horizon_y(self) -> float:
        """Image row of the horizon (may lie outside the frame)."""
        return self.height / 2 - self.f * np.tan(np.radians(self.pitch_deg))

    def ground_to_image(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Ground (x right, y forward, metres from the point under the camera) -> pixel (u, v), plus a valid mask."""
        t = np.radians(self.pitch_deg)
        up = -self.height_m
        z = y * np.cos(t) - up * np.sin(t)
        yc = -y * np.sin(t) - up * np.cos(t)
        valid = z > 1e-3
        zs = np.where(valid, z, 1.0)
        u = self.width / 2 + self.f * x / zs
        v = self.height / 2 + self.f * yc / zs
        return u, v, valid

    def image_to_ground(self, u: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        t = np.radians(self.pitch_deg)
        xn = (u - self.width / 2) / self.f
        yn = (v - self.height / 2) / self.f
        denom = np.sin(t) + yn * np.cos(t)
        valid = denom > 1e-4
        s = np.where(valid, self.height_m / np.where(valid, denom, 1.0), 0.0)
        return s * xn, s * (np.cos(t) - yn * np.sin(t)), valid


@dataclass(frozen=True)
class Grid:
    cell_m: float = 0.1
    half_width_m: float = 3.0
    max_range_m: float = 10.0

    @property
    def nx(self) -> int:
        return int(round(2 * self.half_width_m / self.cell_m))

    @property
    def ny(self) -> int:
        return int(round(self.max_range_m / self.cell_m))

    def centers(self) -> tuple[np.ndarray, np.ndarray]:
        """Row 0 is nearest the camera."""
        xs = -self.half_width_m + (np.arange(self.nx) + 0.5) * self.cell_m
        ys = (np.arange(self.ny) + 0.5) * self.cell_m
        return np.meshgrid(xs, ys)

    def col_x(self, c) -> np.ndarray:
        return -self.half_width_m + (np.asarray(c) + 0.5) * self.cell_m

    def row_y(self, r) -> np.ndarray:
        return (np.asarray(r) + 0.5) * self.cell_m


def to_birds_eye(label_map: np.ndarray, cam: Camera, grid: Grid, fill: int = 0) -> np.ndarray:
    """Nearest-neighbour resample of an image label map onto the ground grid; cells outside the view get `fill`."""
    gx, gy = grid.centers()
    u, v, valid = cam.ground_to_image(gx, gy)
    inside = valid & (u >= 0) & (u <= cam.width - 1) & (v >= 0) & (v <= cam.height - 1)
    mapx = np.where(inside, u, -1).astype(np.float32)
    mapy = np.where(inside, v, -1).astype(np.float32)
    out = cv2.remap(label_map, mapx, mapy, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=fill)
    out[~inside] = fill
    return out
