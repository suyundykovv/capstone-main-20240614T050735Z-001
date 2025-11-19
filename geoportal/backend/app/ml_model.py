"""Simple ML stub that generates deterministic-looking agronomy insights."""
from __future__ import annotations

import random
from datetime import datetime
from typing import Dict, Any

CROPS = [
    {
        "name": "corn",
        "diseases": ["Northern corn leaf blight", "Common rust", "Gray leaf spot"],
        "fertilizers": ["NPK 20-10-10", "Foliar zinc", "UAN 32"]
    },
    {
        "name": "potato",
        "diseases": ["Late blight", "Early blight", "Blackleg"],
        "fertilizers": ["Calcium nitrate", "NPK 12-12-36", "Seaweed biostimulant"]
    },
    {
        "name": "rice",
        "diseases": ["Sheath blight", "Rice blast", "Brown spot"],
        "fertilizers": ["DAP 18-46-0", "Silica foliar", "Potash 0-0-60"]
    },
    {
        "name": "wheat",
        "diseases": ["Stripe rust", "Septoria tritici", "Powdery mildew"],
        "fertilizers": ["NPK 15-15-15", "Chelated micronutrients", "Urea topdress"]
    },
]


def predict(image_bytes: bytes) -> Dict[str, Any]:
    """Return a pseudo prediction based on random sampling."""
    seed = len(image_bytes) or random.randint(1, 10_000)
    random.seed(seed + int(datetime.utcnow().timestamp()))
    crop = random.choice(CROPS)
    disease = random.choice(crop["diseases"])
    fertilizer = random.choice(crop["fertilizers"])
    confidence = round(random.uniform(0.55, 0.98), 2)
    return {
        "crop": crop["name"],
        "disease": disease,
        "confidence": confidence,
        "fertilizer_suggestion": fertilizer,
        "inference_engine": "geoportal-ml-stub-v1",
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
