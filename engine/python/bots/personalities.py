"""Bot personalities (10) for offline play + ladder design.

Ratings are internal targets (not public Elo); styles guide search weights
and flavour text. Real move policies bind in Phase 09.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class BotPersonality:
    id: str
    name: str
    rating: int
    style: str
    blurb: str


PERSONALITIES: list[BotPersonality] = [
    BotPersonality("pawnlet", "Pawnlet", 400, "greedy-advance",
                   "Rushes forward; tutorial-tier, rarely walls."),
    BotPersonality("grooveguard", "Groove Guard", 600, "wall-novice",
                   "Learns wall shapes; blocks the obvious lane."),
    BotPersonality("lantern", "Lantern", 800, "route-seeker",
                   "Follows shortest-path glow; decent endgame."),
    BotPersonality("tollkeeper", "Tollkeeper", 1000, "taxing-walls",
                   "Charges a wall for every rushed advance."),
    BotPersonality("switchback", "Switchback", 1200, "tempo",
                   "Sidesteps contact well; sets diagonal traps."),
    BotPersonality("cartographer", "Cartographer", 1400, "positional",
                   "Bends routes two turns ahead; patient builder."),
    BotPersonality("siegewright", "Siegewright", 1600, "fortress",
                   "Constructs wall mazes; punishes impatience."),
    BotPersonality("jumpcutter", "Jumpcutter", 1800, "contact-tactics",
                   "Masters jumps and sidesteps at contact range."),
    BotPersonality("grandchannel", "Grandchannel", 2100, "strategist",
                   "Balances race vs blockade; endgame converter."),
    BotPersonality("nexusprime", "Nexus Prime", 2400, "apex",
                   "Full-depth search; the mountain at the top."),
]


def get_bot(bot_id: str) -> BotPersonality:
    for bot in PERSONALITIES:
        if bot.id == bot_id:
            return bot
    raise KeyError(f"unknown bot: {bot_id}")
