// Sent instead of a verification email when someone signs up with an email that already has an
// account (#132), so the signup page can answer the same way for every address.
export const signup_attempt_tmpl = (site_url: string) => {
    return {
        subject: 'Someone tried to sign up with your InvokeDB email',
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
      <p>Someone just tried to create an InvokeDB account with this email address, but you already have one. Nothing about your account has changed.</p>
      <p>If it was you, <a href="${site_url}/login" style="color: #3696ea;">sign in</a> instead. If you don't remember your password, you can <a href="${site_url}/forgot-password" style="color: #3696ea;">reset it</a>.</p>
      <p>If it wasn't you, you can ignore this email.</p>
      <div style="margin-top: 20px;">
          <p>If you have any questions, feel free to <a href="${site_url}/contact" style="color: #3696ea;">submit a request</a> to our support team and we'll respond as soon as possible.</p>
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
