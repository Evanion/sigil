//! Component query tools.
//!
//! Currently provides a read-only listing of registered component definitions.
//! Mutation commands (add, remove, update component) are out of scope for this
//! plan and will be added in a later task.

use agent_designer_server::state::AppState;

use crate::server::acquire_document_lock;
use crate::types::ComponentInfo;

// ── Tool implementations ─────────────────────────────────────────────────────

/// Returns a summary of every component definition registered in the document.
///
/// The list is sorted by component name for stable, deterministic output.
#[must_use]
pub fn list_components_impl(state: &AppState) -> Vec<ComponentInfo> {
    let doc = acquire_document_lock(state);
    let mut components: Vec<ComponentInfo> = doc
        .components
        .values()
        .map(|def| ComponentInfo {
            id: def.id().to_string(),
            name: def.name().to_string(),
            variant_count: def.variants().len(),
            property_count: def.properties().len(),
        })
        .collect();
    components.sort_by(|a, b| a.name.cmp(&b.name));
    components
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use agent_designer_core::id::ComponentId;
    use agent_designer_core::{ComponentDef, NodeId};
    use agent_designer_server::state::AppState;
    use uuid::Uuid;

    use super::*;
    use crate::server::acquire_document_lock;

    fn make_component_def(name: &str) -> ComponentDef {
        ComponentDef::new(
            ComponentId::new(Uuid::new_v4()),
            name.to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid component def")
    }

    #[test]
    fn test_list_components_empty() {
        let state = AppState::new();
        let components = list_components_impl(&state);
        assert!(
            components.is_empty(),
            "expected no components in fresh document"
        );
    }

    #[test]
    fn test_list_components_returns_registered_components() {
        let state = AppState::new();

        {
            let mut doc = acquire_document_lock(&state);
            doc.add_component(make_component_def("Button"))
                .expect("add Button");
            doc.add_component(make_component_def("Card"))
                .expect("add Card");
        }

        let components = list_components_impl(&state);
        assert_eq!(components.len(), 2, "expected two components");

        // Sorted by name: Button before Card.
        assert_eq!(components[0].name, "Button");
        assert_eq!(components[1].name, "Card");

        // Counts are correct (no variants or properties were added).
        assert_eq!(components[0].variant_count, 0);
        assert_eq!(components[0].property_count, 0);
    }
}
