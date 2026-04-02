use async_graphql::Object;

pub struct MutationRoot;

#[Object]
impl MutationRoot {
    /// Placeholder — mutations added in Task 2.
    async fn version(&self) -> &str {
        "0.1.0"
    }
}
