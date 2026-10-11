/** The one aw client floor: every path that needs aw, the probe and a grant
 *  seat's custody are held to it. aw 1.36.31 can reply to a sender outside
 *  the team roster; aw 1.36.32 mints grants that never expire. Their custody
 *  reports mail_reply_continuation.v1 and grant_never_ttl.v1. aw 1.36.33 is
 *  the aw `oats aweb resident create` is built and tested on: its custody
 *  starts when its working directory is reached through a symlink. */
export const AW_MIN = '1.36.33';
