

# The simulation adds its templates to the shared resolver and holds every template its members
# read to the leak check (SPEC 7). Done on import so no simulation process can skip it.
from govern import prompts as _prompts  # noqa: E402
from sim.prompts import WORLD_PROMPTS_DIR as _WORLD  # noqa: E402
from sim.realism import assert_clean as _assert_clean  # noqa: E402

_prompts.register_root(_WORLD)
_prompts.register_check("committee/", _assert_clean)
_prompts.register_check("world/", _assert_clean)
