//! Gemeinsame Handgriffe an Seitenressourcen und -inhalten (Schriften und Formulare ergaenzen,
//! eigenen Inhalt hinter den vorhandenen setzen).

use crate::Result;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};

/// Der Seitenbaum-Knoten, der `Resources` besitzt (die Seite selbst oder ein Vorfahr).
fn resources_owner(doc: &Document, page: ObjectId) -> ObjectId {
    let mut id = page;
    for _ in 0..64 {
        let Ok(dict) = doc.get_dictionary(id) else { break };
        if dict.has(b"Resources") {
            return id;
        }
        match dict.get(b"Parent").and_then(Object::as_reference) {
            Ok(parent) => id = parent,
            Err(_) => break,
        }
    }
    page
}

/// Traegt `/<name> <target>` in die Kategorie (`Font`, `XObject` ...) der Seitenressourcen ein.
/// Geerbte Ressourcen werden am Besitzer ergaenzt (ein zusaetzlicher Eintrag schadet den anderen
/// Seiten nicht).
pub(crate) fn add_resource(doc: &mut Document, page: ObjectId, category: &str, name: &str, target: ObjectId) -> Result<()> {
    let owner = resources_owner(doc, page);
    // Resources immer als eigenes Objekt, damit sich Direkt- und Verweisfall gleich behandeln lassen.
    let res_id = match doc.get_dictionary(owner)?.get(b"Resources") {
        Ok(Object::Reference(r)) => *r,
        Ok(Object::Dictionary(d)) => {
            let id = doc.add_object(Object::Dictionary(d.clone()));
            doc.get_object_mut(owner)?.as_dict_mut()?.set("Resources", Object::Reference(id));
            id
        }
        _ => {
            let id = doc.add_object(Object::Dictionary(dictionary! {}));
            doc.get_object_mut(owner)?.as_dict_mut()?.set("Resources", Object::Reference(id));
            id
        }
    };
    let category_id = match doc.get_dictionary(res_id)?.get(category.as_bytes()) {
        Ok(Object::Reference(r)) => Some(*r),
        _ => None,
    };
    match category_id {
        Some(cid) => doc.get_object_mut(cid)?.as_dict_mut()?.set(name, Object::Reference(target)),
        None => {
            let res = doc.get_object_mut(res_id)?.as_dict_mut()?;
            if let Ok(Object::Dictionary(entries)) = res.get_mut(category.as_bytes()) {
                entries.set(name, Object::Reference(target));
            } else {
                res.set(category, Object::Dictionary(dictionary! { name => Object::Reference(target) }));
            }
        }
    }
    Ok(())
}

/// Seiteninhalt als Liste von Strom-Verweisen.
fn content_refs(doc: &Document, page: ObjectId) -> Vec<Object> {
    match doc.get_dictionary(page).ok().and_then(|d| d.get(b"Contents").ok()) {
        Some(Object::Reference(r)) => match doc.get_object(*r) {
            Ok(Object::Array(items)) => items.clone(),
            _ => vec![Object::Reference(*r)],
        },
        Some(Object::Array(items)) => items.clone(),
        _ => vec![],
    }
}

/// Haengt einen Inhaltsstrom hinter den Seiteninhalt. Der vorhandene Inhalt wird in `q ... Q`
/// gefasst: ein unausgewogener Grafikzustand der Seite darf die eigenen Zeichenbefehle nicht
/// verschieben. `open`/`close` sind die gemeinsamen Klammer-Stroeme (siehe `brackets`).
pub(crate) fn append_content(doc: &mut Document, page: ObjectId, brackets: (ObjectId, ObjectId), content: Vec<u8>) -> Result<()> {
    let ours = doc.add_object(Stream::new(dictionary! {}, content));
    let mut contents = vec![Object::Reference(brackets.0)];
    contents.extend(content_refs(doc, page));
    contents.push(Object::Reference(brackets.1));
    contents.push(Object::Reference(ours));
    doc.get_object_mut(page)?.as_dict_mut()?.set("Contents", Object::Array(contents));
    Ok(())
}

/// Die beiden Klammer-Stroeme `q` und `Q`, einmal je Dokument anzulegen.
pub(crate) fn brackets(doc: &mut Document) -> (ObjectId, ObjectId) {
    (
        doc.add_object(Stream::new(dictionary! {}, b"q\n".to_vec())),
        doc.add_object(Stream::new(dictionary! {}, b"\nQ\n".to_vec())),
    )
}
