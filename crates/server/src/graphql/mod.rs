pub mod mutation;
pub mod query;
pub mod subscription;
pub mod types;

use async_graphql::Schema;

use crate::state::AppState;

pub type SigilSchema =
    Schema<query::QueryRoot, mutation::MutationRoot, subscription::SubscriptionRoot>;

/// Builds the GraphQL schema with shared application state.
#[must_use]
pub fn build_schema(state: AppState) -> SigilSchema {
    Schema::build(
        query::QueryRoot,
        mutation::MutationRoot,
        subscription::SubscriptionRoot,
    )
    .data(state)
    .finish()
}
