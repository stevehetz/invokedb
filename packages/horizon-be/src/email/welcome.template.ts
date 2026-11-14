export const welcome_tmpl = (auth_url, db_url, account) => {
    return {
        subject: 'Welcome to InvokeDB',
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
      <p>Welcome to InvokeDB. Below you will find your login information and a few helpful links to get you started.</p>
      <div style="background-color:#f1f1f1; padding:20px 10px;">
          <div style="margin-bottom: 10px;">
              <label style="float: left; display:block; width:100px; font-weight:bold;">Username: </label>
              <a href="" style="color: #484ec0;">${account.email}</a>
          </div>
          <div style="margin-bottom: 30px;">
              <label style="float: left; display:block; width:100px; font-weight:bold;">Login Page: </label>
              <a href="${auth_url}/login" style="color: #3696ea;">${auth_url}/login</a>
          </div>
          <div style="margin-bottom: 10px;">
              <label style="float: left; display:block; width:100px; font-weight:bold;">API Docs: </label>
              <a href="${db_url}/api" style="color: #3696ea;">${db_url}/api</a>
          </div>
          <div style="margin-bottom: 10px;">
              <label style="float: left; display:block; width:100px; font-weight:bold;">Guide: </label>
              <a href="${db_url}/guide" style="color: #3696ea;">${db_url}/guide</a>
          </div>
      </div>
      <div style="margin-top: 20px;">
          <p>If you have any questions, feel free to <a href="${auth_url}/contact" style="color: #3696ea;">submit a request</a> to our support team and we'll respond as soon as possible.</p>
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
