export default function handler(_req, res) {
  res.status(200).json({
    success: true,
    status: "ok",
    service: "time-attendance-app",
    timestamp: new Date().toISOString(),
  });
}
