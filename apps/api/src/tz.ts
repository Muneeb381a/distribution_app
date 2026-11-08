// A shop here works on Pakistan time. A server in another time zone (Vercel runs on UTC) must not decide what "today" is,
// or a bill made at 2 am would be dated yesterday. Set APP_TZ to use a different zone.
process.env.TZ = process.env.APP_TZ ?? 'Asia/Karachi';
