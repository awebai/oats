// Stateful consumer fake built from real aw captures. See ../fixtures/aw-1.36.33/SOURCE.md.
// Test IDs, paths, labels and faults are substitutions, not captured service evidence.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');
const fixtures = path.join(__dirname, '../fixtures/aw-1.36.33/grants');
const json = name => JSON.parse(fs.readFileSync(path.join(fixtures, name + '.stdout'), 'utf8'));
const never = json('grant-mint-never');
const duration = json('grant-mint-90m');
const listEntry = json('grant-list-active').grants[0];
const revokedEntry = json('grant-list-after-revoke').grants.find(g => g.status === 'revoked');
const revoked = json('grant-revoke');

// Match aw's captured indentation and quoted duration expiry, so the consumer
// exercises the native scalar format as well as its value.
exports.serializeGrant = document => {
  const output = new yaml.Document(document);
  if (document.expires_at !== 'never') output.get('expires_at', true).type = yaml.Scalar.QUOTE_DOUBLE;
  return output.toString({indent: 4});
};
exports.createGrantModel = base => {
  const file = path.join(base, 'aw-grants.json');
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const write = grants => fs.writeFileSync(file, JSON.stringify(grants));
  return {
    mint({id, team, ttl, scopes, label, out, socket, alias, address, expiresAt}) {
      const grants = read();
      const count = grants.filter(g => g.grant_id === id || g.grant_id.startsWith(id + '-')).length;
      const grantId = count ? `${id}-${count + 1}` : id;
      const captured = ttl === 'never' ? never : duration;
      const expiry = ttl === 'never' ? captured.expires_at : (expiresAt || captured.expires_at);
      const reply = {...captured, grant_id: grantId, team_id: team, expires_at: expiry,
        out, custody_socket_path: socket, alias, name: alias, address};
      const document = yaml.parse(fs.readFileSync(path.join(fixtures, ttl === 'never' ? 'grant-never.grant.yaml' : 'grant-90m.grant.yaml'), 'utf8'));
      Object.assign(document, {grant_id: grantId, team_id: team, expires_at: expiry, scopes});
      Object.assign(document.subject, {alias, address});
      document.custody.socket_path = socket;
      // Prepend as the captured list does; revoked entries remain visible.
      grants.unshift({...listEntry, grant_id: grantId, team_id: team, expires_at: expiry,
        label, scopes, subject_alias: alias});
      write(grants);
      return {reply, document};
    },
    list(team) { return {grants: read().filter(g => !team || g.team_id === team)}; },
    revoke(id) {
      const grants = read();
      const entry = grants.find(g => g.grant_id === id);
      if (entry) Object.assign(entry, {status: revokedEntry.status, revoked_at: revokedEntry.revoked_at});
      write(grants);
      return {...revoked, grant_id: id};
    }
  };
};
