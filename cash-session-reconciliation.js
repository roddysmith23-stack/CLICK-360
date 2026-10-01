(function (root) {
  'use strict';

  function cashRecordTime(record = {}, fields = []) {
    for (const field of fields) {
      const numeric = Number(record?.[field]);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
      const parsed = Date.parse(record?.[field]);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  function latestCashSession(sessions = [], businessId = '', date = '') {
    return (Array.isArray(sessions) ? sessions : [])
      .map((session, index) => ({ session, index }))
      .filter(({ session }) => session?.businessId === businessId && session?.date === date)
      .sort((a, b) => {
        const timeDifference = cashRecordTime(a.session, ['openedAt', 'createdAtMs']) - cashRecordTime(b.session, ['openedAt', 'createdAtMs']);
        return timeDifference || a.index - b.index;
      })
      .at(-1)?.session || null;
  }

  function cashReportsForSession(reports = [], session = {}) {
    if (!session?.id) return [];
    return (Array.isArray(reports) ? reports : []).filter((report) =>
      report?.businessId === session.businessId
      && report?.date === session.date
      && report?.cashSessionId === session.id);
  }

  function cashSessionIsClosed(session, reports = []) {
    if (!session) return false;
    if (session.status === 'closed') return true;
    return cashReportsForSession(reports, session).some((report) => report.status === 'closed');
  }

  function unresolvedOpenCashSessions(sessions = [], reports = [], businessId = '', date = '') {
    return (Array.isArray(sessions) ? sessions : [])
      .map((session, index) => ({ session, index }))
      .filter(({ session }) => session?.businessId === businessId
        && (!date || session?.date === date)
        && session?.status === 'open'
        && !cashSessionIsClosed(session, reports))
      .sort((a, b) => {
        const dateDifference = String(a.session.date || '').localeCompare(String(b.session.date || ''));
        if (dateDifference) return dateDifference;
        const timeDifference = cashRecordTime(a.session, ['openedAt', 'createdAtMs']) - cashRecordTime(b.session, ['openedAt', 'createdAtMs']);
        return timeDifference || a.index - b.index;
      })
      .map(({ session }) => session);
  }

  function currentOpenCashSession(sessions = [], reports = [], businessId = '', date = '') {
    return unresolvedOpenCashSessions(sessions, reports, businessId, date).at(-1) || null;
  }

  function staleOpenCashSession(sessions = [], reports = [], businessId = '', currentDate = '') {
    return unresolvedOpenCashSessions(sessions, reports, businessId)
      .find((session) => session.date && session.date !== currentDate) || null;
  }

  function isBusinessDateClosed(reports = [], sessions = [], date = '', businessId = '') {
    if (!businessId || !date) return false;
    if (unresolvedOpenCashSessions(sessions, reports, businessId, date).length) return false;
    return (Array.isArray(reports) ? reports : []).some((report) =>
      report?.businessId === businessId && report?.date === date && report?.status === 'closed');
  }

  function cashCloseEligibility(session, reports = []) {
    if (!session?.id) return { allowed: true, reason: 'legacy_date_close' };
    if (cashSessionIsClosed(session, reports)) return { allowed: false, reason: 'session_already_closed' };
    if (session.status !== 'open') return { allowed: false, reason: 'session_not_open' };
    return { allowed: true, reason: 'open_session' };
  }

  function recordsForCashSession(records = [], session = null, businessId = '', date = '') {
    const scoped = (Array.isArray(records) ? records : []).filter((record) =>
      record?.businessId === businessId && record?.date === date);
    return session?.id ? scoped.filter((record) => record?.cashSessionId === session.id) : scoped;
  }

  function latestClosedCashReport(reports = [], businessId = '', date = '') {
    return (Array.isArray(reports) ? reports : [])
      .map((report, index) => ({ report, index }))
      .filter(({ report }) => report?.businessId === businessId && report?.date === date && report?.status === 'closed')
      .sort((a, b) => {
        const timeDifference = cashRecordTime(a.report, ['closedAt', 'createdAtMs']) - cashRecordTime(b.report, ['closedAt', 'createdAtMs']);
        return timeDifference || a.index - b.index;
      })
      .at(-1)?.report || null;
  }

  const api = Object.freeze({
    latestCashSession,
    cashReportsForSession,
    cashSessionIsClosed,
    unresolvedOpenCashSessions,
    currentOpenCashSession,
    staleOpenCashSession,
    isBusinessDateClosed,
    cashCloseEligibility,
    recordsForCashSession,
    latestClosedCashReport
  });

  root.CLICK360_CASH_RECONCILIATION = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
