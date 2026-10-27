// Render the real sync component while keeping native storage and transport outside browser fixtures.
export const coachCalendarSubscriptionFixture = {
  name: 'coach-calendar-subscription-fixture',
  setup(builder) {
    builder.onResolve({ filter: /coachCalendarSubscription(?:\.js)?$/ }, () => ({ path: 'coach-calendar-subscription', namespace: 'calendar-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'calendar-fixture' }, () => ({
      contents: 'export const readCoachCalendarSubscription = async () => ""; export const changeCoachCalendarSubscription = async () => { throw new Error("Calendar subscription transport is outside this browser fixture") };',
      loader: 'js',
    }))
  },
}
