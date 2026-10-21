// Explicit --demo / --self-test only. Separate native profile, no cloud login.
if (window.top === window && ['/', '/index.html'].includes(location.pathname)) {
  // The recovery journal would otherwise restore the previous demo run's records.
  localStorage.removeItem('ptcg-history-journal');
  localStorage.removeItem('ptcg-tracker-backups');
  localStorage.removeItem('ptcg-cloud-user-id');
  localStorage.setItem('ptcg-tracker-data', JSON.stringify({
    personal: {
      playerName: '桌面演示', currentDeckId: 'demo',
      decks: { demo: { name: '喷火龙 ex', accumulatedWins: 0, accumulatedLosses: 0 } },
      deckList: [{ name: '沙奈朵 ex' }, { name: '多龙巴鲁托 ex' }],
      draftMatch: { deckId: 'demo', firstMove: 'first', opponentDeck: '沙奈朵 ex' },
      matchHistory: Array.from({ length: 10 }, (_, i) => ({
        id: 'desktop-demo-' + i, deckId: 'demo', deckName: '喷火龙 ex',
        result: i < 7 ? 'win' : 'loss', time: new Date().toISOString(),
      })),
    },
  }));
  sessionStorage.removeItem('ptcg-cloud-session');
}
