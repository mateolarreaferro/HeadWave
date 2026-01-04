import numpy as np


def linear(value: float, min_out: float = 0.0, max_out: float = 1.0) -> float:
    return min_out + value * (max_out - min_out)


def exponential(value: float, exponent: float = 2.0) -> float:
    return pow(max(0, min(1, value)), exponent)


def logarithmic(value: float, base: float = 10.0) -> float:
    if value <= 0:
        return 0.0
    return np.log(1 + value * (base - 1)) / np.log(base)


def sigmoid(value: float, steepness: float = 5.0, midpoint: float = 0.5) -> float:
    x = (value - midpoint) * steepness
    return 1.0 / (1.0 + np.exp(-x))


def threshold(value: float, thresh: float = 0.5,
              below: float = 0.0, above: float = 1.0) -> float:
    return above if value >= thresh else below


def deadzone(value: float, low: float = 0.1, high: float = 0.9) -> float:
    if value < low:
        return 0.0
    elif value > high:
        return 1.0
    else:
        return (value - low) / (high - low)


def invert(value: float) -> float:
    return 1.0 - max(0, min(1, value))


def smooth_step(value: float) -> float:
    t = max(0, min(1, value))
    return t * t * (3 - 2 * t)


CURVES = {
    'linear': linear,
    'exponential': exponential,
    'logarithmic': logarithmic,
    'sigmoid': sigmoid,
    'threshold': threshold,
    'deadzone': deadzone,
    'invert': invert,
    'smoothstep': smooth_step,
}


def apply_curve(value: float, curve_type: str, **params) -> float:
    curve_fn = CURVES.get(curve_type, linear)
    try:
        return curve_fn(value, **params)
    except TypeError:
        return curve_fn(value)
