import sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from housing import cbs  # noqa: E402


def test_cbs_file_loads_monthly_from_1996():
    year, yoy = cbs.load()
    assert abs(year[0] - (1996 + 0.5 / 12)) < 1e-3 and abs(yoy[0] - 7.639) < 1e-3
    assert np.allclose(np.diff(year), 1 / 12, atol=1e-3)


def test_best_lag_recovers_a_known_shift():
    year, yoy = cbs.load()
    model_year = np.arange(1996.46, 2025.4, 0.02)
    shifted = np.interp(model_year - 5 / 12, year, yoy)  # the 'model' runs 5 months behind the data
    lag, c, _ = cbs.best_lag(model_year, shifted)
    assert lag == 5 and c > 0.99
