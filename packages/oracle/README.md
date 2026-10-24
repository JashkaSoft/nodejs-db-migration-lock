# @nodejs-db-migration-lock/oracle

Oracle migration lock using `DBMS_LOCK.REQUEST` / `DBMS_LOCK.RELEASE` on one session. Exclusive mode is `DBMS_LOCK.X_MODE`. The lock id is in `0..1073741823`. When `lockId` is omitted it is `CRC32(DB_NAME)` masked to that range.

[node-oracledb](https://github.com/oracle/node-oracledb) is the open-source driver. Install it from npm. Thin mode is the default: pure JavaScript, no Oracle Instant Client, and no `initOracleClient()` call. It connects to Oracle Database 12.1 or later. Thick mode is optional and needs Oracle Client 19 or later; this package does not enable it.

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/oracle oracledb
```

The connect string is Easy Connect, `host/service` or `host:port/service`, as in the [getting started guide](https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html#getting-started-with-node-oracledb). Runnable samples are in the [node-oracledb examples](https://github.com/oracle/node-oracledb/tree/main/examples).

```typescript
import { MigrationCoordinator } from '@nodejs-db-migration-lock/core';
import { OracleAppLock, OracleDriver } from '@nodejs-db-migration-lock/oracle';

const driver = new OracleDriver({
  user: 'system',
  password: process.env.ORACLE_PASSWORD || 'password',
  connectString: 'localhost/FREEPDB1',
});
const lock = new OracleAppLock();
```

`DBMS_LOCK.REQUEST` is a PL/SQL call. The return code is an OUT bind `{ dir: oracledb.BIND_OUT, type: oracledb.NUMBER }`, the same shape as the [PL/SQL examples](https://node-oracledb.readthedocs.io/en/latest/user_guide/plsql_execution.html). Rows come back as objects (`oracledb.OUT_FORMAT_OBJECT`).

`scope: 'transaction'` sets `release_on_commit => TRUE`. The coordinator then commits that session when `migrate()` finishes. The default is a session lock, which survives the transactions a migration runner opens.

The database user needs `EXECUTE` on `DBMS_LOCK`.

## Release the lock by hand

There is no `forceRelease`. `DBMS_LOCK.RELEASE` works only on the session that called `REQUEST`. `migrate()` calls it when the migration finishes. A crashed process releases the lock when the session disconnects.

A hung session has to be killed:

```sql
SELECT sid, serial# FROM v$session WHERE sid IN (
  SELECT sid FROM v$lock WHERE type = 'UL'
);
ALTER SYSTEM KILL SESSION '<sid>,<serial#>' IMMEDIATE;
```

`UL` is the lock type `DBMS_LOCK` uses.
