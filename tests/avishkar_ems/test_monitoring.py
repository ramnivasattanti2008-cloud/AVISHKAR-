import pandas as pd
import numpy as np
import pytest
from avishkar_ems.monitor import enhanced_monitor, validate_readings, DEVIATION_MODES


def make_df(start, periods, freq='15T', pv_vals=None, exp_vals=None, poa_vals=None):
    idx = pd.date_range(start=start, periods=periods, freq=freq)
    data = {
        'pv_kw': pv_vals if pv_vals is not None else np.full(periods, 5.0),
        'expected_kw': exp_vals if exp_vals is not None else np.full(periods, 6.0),
        'poa_wm2': poa_vals if poa_vals is not None else np.full(periods, 300.0),
    }
    return pd.DataFrame(data, index=idx)


def test_validate_missing_column():
    df = make_df('2023-01-01', 4)
    df = df.drop(columns=['expected_kw'])
    with pytest.raises(ValueError, match='Missing required columns'):
        validate_readings(df)


def test_validate_negative_values():
    df = make_df('2023-01-01', 4)
    df.loc[df.index[0], 'pv_kw'] = -1.0
    with pytest.raises(ValueError, match='Negative values detected'):
        validate_readings(df)


def test_validate_timestamp_gap():
    # create a gap larger than 90 minutes
    idx = pd.DatetimeIndex(['2023-01-01 00:00', '2023-01-01 00:15', '2023-01-01 02:00'])
    df = pd.DataFrame({
        'pv_kw': [5, 5, 5],
        'expected_kw': [6, 6, 6],
        'poa_wm2': [300, 300, 300],
    }, index=idx)
    with pytest.raises(ValueError, match='Timestamp gap larger than 90 minutes'):
        validate_readings(df)


def test_enhanced_monitor_flags():
    # create a scenario where pv is much lower than expected (underperformance)
    df = make_df('2023-01-01', 8, pv_vals=np.array([5,5,1,1,1,5,5,5]),
                 exp_vals=np.full(8,6), poa_vals=np.full(8,300))
    # the low segment (indices 2-4) lasts 3 steps (45 min) which is >= min_steps=4? Actually min_steps=4, so should not flag.
    # Increase low segment to 4 steps to trigger.
    df.loc[df.index[2:6], 'pv_kw'] = 1.0
    res = enhanced_monitor(df)
    # Expect flag on low segment (indices 2-5) because min_steps=4 and ratio<0.85.
    flagged = res['flag']
    assert flagged.iloc[2] and flagged.iloc[5]  # start and end of run flagged
    # Fault mode should be underperformance for those rows
    assert all(res['fault_mode'][flagged] == DEVIATION_MODES.UNDERPERFORMANCE.value)
