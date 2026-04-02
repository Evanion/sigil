pub mod mutation;
pub mod query;
pub mod subscription;
pub mod types;

use async_graphql::Schema;

use crate::state::AppState;

pub type SigilSchema =
    Schema<query::QueryRoot, mutation::MutationRoot, subscription::SubscriptionRoot>;

/// Maximum allowed query depth for GraphQL operations.
///
/// Prevents deeply nested queries from consuming excessive resources.
const MAX_QUERY_DEPTH: usize = 10;

/// Maximum allowed query complexity for GraphQL operations.
///
/// Limits the total cost of a single query to prevent abuse.
const MAX_QUERY_COMPLEXITY: usize = 500;

/// Builds the GraphQL schema with shared application state.
///
/// Applies query depth and complexity limits to prevent resource exhaustion.
#[must_use]
pub fn build_schema(state: AppState) -> SigilSchema {
    Schema::build(
        query::QueryRoot,
        mutation::MutationRoot,
        subscription::SubscriptionRoot,
    )
    .data(state)
    .limit_depth(MAX_QUERY_DEPTH)
    .limit_complexity(MAX_QUERY_COMPLEXITY)
    .finish()
}
