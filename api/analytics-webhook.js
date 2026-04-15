export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, table, record, old_record, errors } = req.body;

    // Log the webhook event
    const timestamp = new Date().toISOString();
    console.log(`[Analytics Webhook] ${timestamp} - ${type} on ${table}`);

    // Process based on table type
    switch (table) {
      case 'employees':
        await handleEmployeeAnalytics(record, old_record, type);
        break;

      case 'attendance':
        await handleAttendanceAnalytics(record, old_record, type);
        break;

      case 'clock_events':
        await handleClockAnalytics(record, old_record, type);
        break;

      case 'shifts':
        await handleShiftAnalytics(record, old_record, type);
        break;

      case 'leave_applications':
        await handleLeaveAnalytics(record, old_record, type);
        break;

      default:
        console.log(`[Analytics Webhook] Unhandled table: ${table}`);
    }

    return res.status(200).json({
      success: true,
      received: true,
      timestamp,
      table,
      type
    });

  } catch (error) {
    console.error('[Analytics Webhook] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleEmployeeAnalytics(record, oldRecord, type) {
  const analytics = {
    event: 'employee_change',
    type,
    data: {
      id: record?.id,
      employee_code: record?.employee_code,
      first_name: record?.first_name,
      last_name: record?.last_name,
      status: record?.status,
      region: record?.region,
      store: record?.store,
    },
    timestamp: new Date().toISOString()
  };

  console.log('[Employee Analytics]', JSON.stringify(analytics, null, 2));

  // You can extend this to:
  // - Save to a Supabase analytics table
  // - Send to external analytics service
  // - Trigger notifications
  // - Update dashboard metrics

  return analytics;
}

async function handleAttendanceAnalytics(record, oldRecord, type) {
  const analytics = {
    event: 'attendance_change',
    type,
    data: {
      id: record?.id,
      employee_code: record?.employee_code,
      date: record?.date,
      status: record?.status,
      region: record?.region,
      store: record?.store,
    },
    timestamp: new Date().toISOString()
  };

  console.log('[Attendance Analytics]', JSON.stringify(analytics, null, 2));
  return analytics;
}

async function handleClockAnalytics(record, oldRecord, type) {
  const analytics = {
    event: 'clock_event_change',
    type,
    data: {
      id: record?.id,
      employee_code: record?.employee_code,
      clock_date: record?.clock_date,
      clock_time: record?.clock_time,
      direction: record?.direction,
      store: record?.store,
    },
    timestamp: new Date().toISOString()
  };

  console.log('[Clock Analytics]', JSON.stringify(analytics, null, 2));
  return analytics;
}

async function handleShiftAnalytics(record, oldRecord, type) {
  const analytics = {
    event: 'shift_change',
    type,
    data: {
      id: record?.id,
      sheet_name: record?.sheet_name,
      date: record?.date,
      employee_code: record?.employee_code,
    },
    timestamp: new Date().toISOString()
  };

  console.log('[Shift Analytics]', JSON.stringify(analytics, null, 2));
  return analytics;
}

async function handleLeaveAnalytics(record, oldRecord, type) {
  const analytics = {
    event: 'leave_change',
    type,
    data: {
      id: record?.id,
      employee_code: record?.employee_code,
      leave_type: record?.leave_type,
      status: record?.status,
      start_date: record?.start_date,
      end_date: record?.end_date,
    },
    timestamp: new Date().toISOString()
  };

  console.log('[Leave Analytics]', JSON.stringify(analytics, null, 2));
  return analytics;
}
