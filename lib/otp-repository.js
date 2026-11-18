export function createOtpRepository(db) {
  function checked(result) {
    if (result.error) throw new Error('database_unavailable');
    return result.data;
  }
  return {
    async findAccounts(phones) {
      const rows = checked(await db.from('otp_accounts')
        .select('id,label,disney_email,gmail_tokens(access_token,refresh_token,expires_at,gmail_email,connection_version)')
        .in('phone_number', phones).eq('service', 'disney').eq('is_active', true));
      return (rows || []).map((row) => ({ ...row, token: Array.isArray(row.gmail_tokens) ? row.gmail_tokens[0] : row.gmail_tokens }));
    },
    async claim(accountId, lockId) {
      const result = checked(await db.rpc('claim_otp_check', { p_account_id: accountId, p_lock_id: lockId }));
      return result?.[0] || { acquired: false, retry_after: 5 };
    },
    async updateToken(accountId, connectionVersion, values) {
      const rows = checked(await db.from('gmail_tokens').update(values).eq('otp_account_id', accountId)
        .eq('connection_version', connectionVersion).select('otp_account_id'));
      if (rows?.length !== 1) throw new Error('connection_changed');
    },
    async finish({ accountId, lockId, connectionVersion, recipient, status, messageId, receivedAt }) {
      return checked(await db.rpc('finish_otp_check', {
        p_account_id: accountId, p_lock_id: lockId, p_connection_version: connectionVersion,
        p_recipient: recipient, p_status: status, p_message_id: messageId, p_received_at: receivedAt,
      }));
    },
  };
}
