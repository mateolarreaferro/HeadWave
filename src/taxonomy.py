"""
Biosignal-Visual Taxonomy for HeadWave
Based on Spellburst paper's semantic mapping approach.

Maps natural language keywords to biosignal sources and visual properties.
"""

from typing import List, Dict, Tuple
import re


# ============ KEYWORD-TO-BIOSIGNAL MAPPINGS ============

# Keywords that suggest alpha/calm mapping
ALPHA_KEYWORDS = {
    "calm", "peaceful", "serene", "gentle", "soft", "slow", "breathing",
    "meditative", "relaxed", "tranquil", "quiet", "subtle", "ambient",
    "flowing", "drift", "float", "ease", "smooth", "wave", "pulse",
    "organic", "natural", "zen", "mindful"
}

# Keywords that suggest beta/focus mapping
BETA_KEYWORDS = {
    "focus", "sharp", "precise", "geometric", "structured", "active",
    "energetic", "dynamic", "rapid", "quick", "bright", "contrast",
    "angular", "pattern", "grid", "matrix", "digital", "electric",
    "intense", "strong", "bold", "defined", "clear"
}

# Keywords that suggest theta/creative mapping
THETA_KEYWORDS = {
    "dream", "creative", "flowing", "morphing", "abstract", "surreal",
    "psychedelic", "trippy", "spiral", "gradient", "blend", "transition",
    "evolve", "transform", "liquid", "fluid", "ethereal", "mystical",
    "imagination", "vision", "fantasy"
}

# Keywords that suggest gamma/cognitive mapping
GAMMA_KEYWORDS = {
    "complex", "intricate", "detailed", "fractal", "mandala", "sacred",
    "geometry", "recursive", "neural", "network", "connection", "particle",
    "swarm", "flock", "emergence", "chaos", "order", "pattern", "dense"
}

# Keywords that suggest hand tracking
HAND_KEYWORDS = {
    "touch", "grab", "pinch", "gesture", "hand", "control", "drag",
    "pull", "push", "squeeze", "reach", "point", "grasp", "interact"
}

# Keywords that suggest face tracking
FACE_KEYWORDS = {
    "smile", "expression", "emotion", "face", "gaze", "look", "eye",
    "brow", "mouth", "mood", "happy", "sad", "surprised", "emotion"
}


# ============ VISUAL PROPERTY MAPPINGS ============

BIOSIGNAL_TO_VISUAL = {
    "alpha": {
        "params": ["calmLevel", "relaxation", "serenity"],
        "visual_properties": {
            "speed": (0.01, 0.03),      # Slow
            "intensity": (0.3, 0.7),     # Gentle
            "complexity": (3, 8),        # Low-medium
            "hue_range": (180, 270),     # Blues, purples
        },
        "description": "Gentle pulsing, soft colors, slow motion"
    },
    "beta": {
        "params": ["focusLevel", "activity", "energy"],
        "visual_properties": {
            "speed": (0.04, 0.1),        # Fast
            "intensity": (0.7, 1.5),     # Strong
            "complexity": (8, 20),       # High
            "hue_range": (0, 60),        # Reds, oranges, yellows
        },
        "description": "Sharp edges, high contrast, rapid motion"
    },
    "theta": {
        "params": ["creativity", "dreaminess", "flow"],
        "visual_properties": {
            "speed": (0.02, 0.05),       # Medium
            "intensity": (0.4, 0.9),     # Variable
            "complexity": (5, 12),       # Medium
            "hue_range": (260, 330),     # Purples, magentas
        },
        "description": "Flowing shapes, color gradients, morphing"
    },
    "gamma": {
        "params": ["cognition", "insight", "complexity"],
        "visual_properties": {
            "speed": (0.05, 0.08),       # Medium-fast
            "intensity": (0.6, 1.2),     # Strong
            "complexity": (12, 25),      # Very high
            "hue_range": (30, 90),       # Oranges, greens
        },
        "description": "Complex patterns, fine detail, rapid changes"
    },
    "handPinch": {
        "params": ["pinchIntensity", "gestureStrength", "controlLevel"],
        "visual_properties": {
            "intensity": (0, 2.0),       # Full range
            "scale": (0.5, 2.0),         # Size control
        },
        "description": "Direct intensity/trigger control"
    },
    "faceSmile": {
        "params": ["happiness", "brightness", "warmth"],
        "visual_properties": {
            "brightness": (50, 100),     # Brighter when smiling
            "saturation": (40, 90),      # More vibrant
            "hue_shift": (-20, 20),      # Warmer colors
        },
        "description": "Emotional color/brightness response"
    }
}


# ============ KEYWORD EXTRACTION ============

def extract_keywords(prompt: str) -> List[str]:
    """Extract relevant keywords from a natural language prompt."""
    prompt_lower = prompt.lower()
    words = set(re.findall(r'\b[a-z]+\b', prompt_lower))

    found_keywords = []

    # Check all keyword categories
    for keyword in ALPHA_KEYWORDS | BETA_KEYWORDS | THETA_KEYWORDS | GAMMA_KEYWORDS | HAND_KEYWORDS | FACE_KEYWORDS:
        if keyword in words or keyword in prompt_lower:
            found_keywords.append(keyword)

    return found_keywords


def classify_biosignal_affinity(prompt: str) -> Dict[str, float]:
    """
    Analyze a prompt and determine which biosignals it maps to.
    Returns a dict with biosignal types and their affinity scores (0-1).
    """
    prompt_lower = prompt.lower()
    words = set(re.findall(r'\b[a-z]+\b', prompt_lower))

    scores = {
        "alpha": 0.0,
        "beta": 0.0,
        "theta": 0.0,
        "gamma": 0.0,
        "hand": 0.0,
        "face": 0.0
    }

    # Count keyword matches
    for keyword in ALPHA_KEYWORDS:
        if keyword in words or keyword in prompt_lower:
            scores["alpha"] += 1

    for keyword in BETA_KEYWORDS:
        if keyword in words or keyword in prompt_lower:
            scores["beta"] += 1

    for keyword in THETA_KEYWORDS:
        if keyword in words or keyword in prompt_lower:
            scores["theta"] += 1

    for keyword in GAMMA_KEYWORDS:
        if keyword in words or keyword in prompt_lower:
            scores["gamma"] += 1

    for keyword in HAND_KEYWORDS:
        if keyword in words or keyword in prompt_lower:
            scores["hand"] += 1

    for keyword in FACE_KEYWORDS:
        if keyword in words or keyword in prompt_lower:
            scores["face"] += 1

    # Normalize scores
    max_score = max(scores.values()) if max(scores.values()) > 0 else 1
    for key in scores:
        scores[key] = min(1.0, scores[key] / max(3, max_score))

    # If no clear affinity, default to alpha (calm)
    if max(scores.values()) < 0.1:
        scores["alpha"] = 0.5

    return scores


def get_semantic_mapping(prompt: str) -> Dict:
    """
    Create a semantic mapping from a prompt for generation context.
    Returns suggested parameters and biosignal mappings.
    """
    keywords = extract_keywords(prompt)
    affinities = classify_biosignal_affinity(prompt)

    # Find primary and secondary biosignal types
    sorted_affinities = sorted(affinities.items(), key=lambda x: x[1], reverse=True)
    primary = sorted_affinities[0]
    secondary = sorted_affinities[1] if len(sorted_affinities) > 1 else None

    # Build parameter suggestions based on primary biosignal
    suggested_params = []

    # Get primary biosignal mapping
    if primary[0] in BIOSIGNAL_TO_VISUAL:
        mapping = BIOSIGNAL_TO_VISUAL[primary[0]]
        param_name = mapping["params"][0] if mapping["params"] else "intensity"
        suggested_params.append({
            "keyword": primary[0],
            "param": param_name,
            "biosignal": primary[0],
            "affinity": primary[1]
        })

    # Add secondary if significant
    if secondary and secondary[1] > 0.2 and secondary[0] in BIOSIGNAL_TO_VISUAL:
        mapping = BIOSIGNAL_TO_VISUAL[secondary[0]]
        param_name = mapping["params"][0] if mapping["params"] else "secondary"
        suggested_params.append({
            "keyword": secondary[0],
            "param": param_name,
            "biosignal": secondary[0],
            "affinity": secondary[1]
        })

    # Always include base parameters
    base_params = [
        {"keyword": "speed", "param": "speed", "biosignal": "any", "affinity": 0.5},
        {"keyword": "color", "param": "colorShift", "biosignal": "any", "affinity": 0.5}
    ]

    return {
        "keywords": keywords,
        "affinities": affinities,
        "primary_biosignal": primary[0] if primary[1] > 0.1 else "alpha",
        "suggested_params": suggested_params + base_params,
        "visual_hints": BIOSIGNAL_TO_VISUAL.get(primary[0], {}).get("description", "")
    }


def enhance_prompt_with_context(prompt: str) -> str:
    """
    Enhance a generation prompt with semantic context based on keyword analysis.
    """
    mapping = get_semantic_mapping(prompt)

    # Build context string
    context_parts = []

    if mapping["visual_hints"]:
        context_parts.append(f"Visual style: {mapping['visual_hints']}")

    if mapping["primary_biosignal"]:
        biosignal = mapping["primary_biosignal"]
        context_parts.append(f"Optimized for {biosignal} biosignal modulation")

    if mapping["suggested_params"]:
        param_names = [p["param"] for p in mapping["suggested_params"][:4]]
        context_parts.append(f"Include parameters: {', '.join(param_names)}")

    if context_parts:
        return f"{prompt}\n\nCONTEXT: {' | '.join(context_parts)}"

    return prompt
