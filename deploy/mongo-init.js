// Runs once, when the Mongo data volume is first created (docker-entrypoint-initdb.d). Creates
// the app's user. It needs every horizon* database (one per account, created on demand), so it
// gets the "any database" roles rather than one database.
db.getSiblingDB('admin').createUser({
    user: 'horizon',
    pwd: process.env.MONGO_APP_PASSWORD,
    roles: ['readWriteAnyDatabase', 'dbAdminAnyDatabase']
});
