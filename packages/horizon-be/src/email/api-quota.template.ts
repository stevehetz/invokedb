// Sent once a month at 80% and at 100% of the plan's monthly API quota (#274)
export const api_quota_tmpl = (
    site_url: string,
    opts: { level: 80 | 100; plan_name: string; cap: number; month: string }
) => {
    const base = (site_url || '').replace(/\/$/, '');
    const cap = opts.cap.toLocaleString('en-US');
    const full = opts.level === 100;
    const subject = full
        ? `You've used all of this month's InvokeDB API calls`
        : `You've used 80% of this month's InvokeDB API calls`;
    const lead = full
        ? `Your account has made all ${cap} API calls your plan (${opts.plan_name}) allows in ${opts.month} (UTC). Until the 1st of next month (UTC), the API answers 429 to every call. The app keeps working.`
        : `Your account has made 80% of the ${cap} API calls your plan (${opts.plan_name}) allows in ${opts.month} (UTC). Once all of them are used, the API answers 429 until the 1st of next month (UTC).`;
    return {
        subject,
        body: `
<!DOCTYPE html
        PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">

<head>
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta http-equiv="Content-Type"
        content="text/html; charset=UTF-8" />
  <title></title>
  <style type="text/css" rel="stylesheet" media="all">
      @import url("https://fonts.googleapis.com/css?family=Nunito+Sans:400,700&display=swap");
  </style>
</head>

<body style="font-weight: normal; font-family: 'Nunito Sans', Arial, Helvetica, sans-serif; font-size: 15px; color: #363636; width: 100%;
height: 100%;">
  <div style="width: 100%; max-width: 500px;margin: 20px 5px;padding: 10px;">
      <h2 style="border-bottom: solid 2px #484ec0; padding-bottom: 10px; font-weight:normal;">InvokeDB</h2>
      <p>${lead}</p>
      <p>See your <a href="${base}/app/account" style="color: #3696ea;">usage</a>, or compare the <a href="${base}/pricing" style="color: #3696ea;">plans</a> for more calls.</p>
      <div style="margin-top: 20px;">
          <p>If you have any questions, feel free to <a href="${base}/contact" style="color: #3696ea;">submit a request</a> to our support team and we'll respond as soon as possible.</p>
      </div>
      <div>
          <p style="margin:0 0 5px 0;">Thanks,</p>
          <p style="margin:0;">The InvokeDB Team</p>
      </div>
  </div>
</body>

</html>
        `
    };
};
