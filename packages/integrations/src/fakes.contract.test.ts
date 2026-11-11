import { ManualClock } from "@bbn/domain";
import { emailSenderContract, messageQueueContract, objectStorageContract, paymentsContract, socialPublisherContract } from "./contracts";
import { FakeEmailSender, FakeMessageQueue, FakeObjectStorage, FakePaymentsProvider, FakeSocialPublisher } from "./fakes";
import { PRICE_CATALOG } from "./index";

objectStorageContract("fake", () => {
  const clock = new ManualClock();
  const storage = new FakeObjectStorage(clock);
  return { storage, advanceSeconds: (s) => clock.advanceSeconds(s), verifyGet: (url) => storage.verifySignedUrl(url, "GET") };
});

messageQueueContract("fake", () => {
  const clock = new ManualClock();
  return { queue: new FakeMessageQueue(clock), advanceSeconds: (s) => clock.advanceSeconds(s) };
});

emailSenderContract("fake", () => ({ email: new FakeEmailSender() }));

paymentsContract("fake", () => {
  const clock = new ManualClock();
  const payments = new FakePaymentsProvider(clock, PRICE_CATALOG);
  return { payments, sign: (t, d, o) => payments.signEvent(t, d, o), advanceSeconds: (s) => clock.advanceSeconds(s) };
});

for (const provider of ["facebook_page", "instagram_business", "linkedin_page"] as const) {
  socialPublisherContract(`fake ${provider}`, () => ({ publisher: new FakeSocialPublisher(provider) }));
}
