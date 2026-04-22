-- Optimized indexes for performance
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_employees_region_store ON employees(region, store);
CREATE INDEX IF NOT EXISTS idx_clock_events_date_employee ON biometric_clock_events(clock_date, employee_code);

-- Create a view for clock overview stats (computed in database)
CREATE OR REPLACE VIEW clock_overview_stats AS
SELECT 
  COUNT(*) as total_events,
  COUNT(DISTINCT employee_code) as employees_with_clocks,
  COUNT(*) FILTER (WHERE access_verified = true) as verified_events,
  COUNT(DISTINCT clock_date) as total_days,
  COUNT(DISTINCT store) FILTER (WHERE store != '') as total_stores
FROM biometric_clock_events;

-- Create a view for employee clock summaries
CREATE OR REPLACE VIEW employee_clock_summaries AS
SELECT 
  employee_code,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE access_verified = true) as verified_events,
  MAX(clocked_at) as last_clocked_at,
  ARRAY_AGG(DISTINCT store) FILTER (WHERE store != '') as stores
FROM biometric_clock_events
GROUP BY employee_code;

-- Create a function to get clock overview stats efficiently
CREATE OR REPLACE FUNCTION get_clock_overview_stats(p_start_date DATE, p_end_date DATE)
RETURNS TABLE (
  total_events BIGINT,
  employees_with_clocks BIGINT,
  verified_events BIGINT,
  total_days BIGINT,
  stores TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_events,
    COUNT(DISTINCT employee_code)::BIGINT as employees_with_clocks,
    COUNT(*) FILTER (WHERE access_verified = true)::BIGINT as verified_events,
    COUNT(DISTINCT clock_date)::BIGINT as total_days,
    ARRAY_AGG(DISTINCT store) FILTER (WHERE store != '')::TEXT[] as stores
  FROM biometric_clock_events
  WHERE clock_date >= p_start_date AND clock_date <= p_end_date;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get employee summaries efficiently
CREATE OR REPLACE FUNCTION get_employee_clock_summaries(p_start_date DATE, p_end_date DATE)
RETURNS TABLE (
  employee_code TEXT,
  total_events BIGINT,
  verified_events BIGINT,
  last_clocked_at TIMESTAMPTZ,
  stores TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bce.employee_code::TEXT,
    COUNT(*)::BIGINT as total_events,
    COUNT(*) FILTER (WHERE bce.access_verified = true)::BIGINT as verified_events,
    MAX(bce.clocked_at) as last_clocked_at,
    ARRAY_AGG(DISTINCT bce.store) FILTER (WHERE bce.store != '')::TEXT[] as stores
  FROM biometric_clock_events bce
  WHERE bce.clock_date >= p_start_date AND bce.clock_date <= p_end_date
  GROUP BY bce.employee_code;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT ON clock_overview_stats TO anon, authenticated;
GRANT SELECT ON employee_clock_summaries TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_clock_overview_stats TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_employee_clock_summaries TO anon, authenticated;
