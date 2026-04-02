use async_graphql::Subscription;
use futures_util::Stream;

pub struct SubscriptionRoot;

#[Subscription]
impl SubscriptionRoot {
    /// Placeholder — subscriptions added in Task 3.
    async fn ping(&self) -> impl Stream<Item = String> {
        async_stream::stream! {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                yield "pong".to_string();
            }
        }
    }
}
