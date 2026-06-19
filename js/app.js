/* Движок геопортала на Leaflet. Управляется через window.PORTAL_CONFIG (config.js). */
(function () {
  "use strict";

  var cfg = window.PORTAL_CONFIG;
  var POPUP = cfg.popup || {};
  var searchIndex = []; // {name, layerId, latlng, layer (feature layer)}

  // --- Карта ---
  var map = L.map("map", {
    center: cfg.map.center,
    zoom: cfg.map.zoom,
    minZoom: cfg.map.minZoom,
    maxZoom: cfg.map.maxZoom,
    zoomControl: true
  });

  // Выделенная панель для слоёв OSM-основы — поверх любой подложки (в т.ч. спутника)
  map.createPane("osmOverlay");
  map.getPane("osmOverlay").style.zIndex = 450;

  // --- Подложки ---
  var basemapLayers = {};
  cfg.basemaps.forEach(function (b) {
    basemapLayers[b.id] = L.tileLayer(b.url, {
      attribution: b.attribution,
      maxZoom: b.maxZoom || cfg.map.maxZoom,
      subdomains: b.url.indexOf("{s}") !== -1 ? "abc" : []
    });
  });

  var defaultBasemap = cfg.basemaps.find(function (b) { return b.default; }) || cfg.basemaps[0];
  basemapLayers[defaultBasemap.id].addTo(map);

  // Переключатель подложек — стандартная кнопка-контрол в правом верхнем углу
  var baseMapsByName = {};
  cfg.basemaps.forEach(function (b) { baseMapsByName[b.name] = basemapLayers[b.id]; });
  L.control.layers(baseMapsByName, null, { position: "topright", collapsed: true }).addTo(map);

  // --- Инструмент измерений ---
  L.control.measure({
    primaryLengthUnit: "kilometers",
    secondaryLengthUnit: "meters",
    primaryAreaUnit: "sqkilometers",
    activeColor: "#f0883e",
    completedColor: "#58a6ff",
    position: "topright"
  }).addTo(map);

  // Иконка-звезда (SVG) с яркой заливкой и белой обводкой
  function makeStarIcon(color, size) {
    size = size || 24;
    var html =
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
      'style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">' +
      '<path d="M12 .8l3.4 6.9 7.6 1.1-5.5 5.36 1.3 7.58L12 18.16 5.2 21.74l1.3-7.58L1 8.8l7.6-1.1z" ' +
      'fill="' + color + '" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    return L.divIcon({
      html: html,
      className: "star-marker",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });
  }

  function markerColor(markerCfg, props) {
    var key = (props || {})[markerCfg.colorField];
    return (markerCfg.colors && markerCfg.colors[key]) || markerCfg.defaultColor || "#ff4081";
  }

  function starSvg(color, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
      '<path d="M12 .8l3.4 6.9 7.6 1.1-5.5 5.36 1.3 7.58L12 18.16 5.2 21.74l1.3-7.58L1 8.8l7.6-1.1z" ' +
      'fill="' + color + '" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  }

  // --- Тематические слои ---
  var overlayLayers = {}; // id -> L.geoJSON | L.featureGroup
  var layerMeta = {};     // id -> { categorized, parent, typeGroups, enabledTypes }
  var loadPromises = cfg.layers.map(function (layerCfg) {
    return fetch(layerCfg.geojson)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " для " + layerCfg.geojson);
        return r.json();
      })
      .then(function (geojson) {
        var pcfg = layerCfg.popup || POPUP;
        var categorized = !!(layerCfg.marker && layerCfg.marker.shape === "star" && layerCfg.marker.colors);

        if (categorized) {
          var mk = layerCfg.marker;
          var parent = L.featureGroup();
          var typeGroups = {};   // type -> L.featureGroup
          var enabledTypes = {}; // type -> bool

          (geojson.features || []).forEach(function (feature) {
            if (!feature.geometry || feature.geometry.type !== "Point") return;
            var c = feature.geometry.coordinates;
            var latlng = L.latLng(c[1], c[0]);
            var props = feature.properties || {};
            var type = props[mk.colorField] || "—";
            var color = markerColor(mk, props);
            var marker = L.marker(latlng, { icon: makeStarIcon(color, mk.size) });
            marker.bindPopup(buildPopupHtml(props, pcfg), { maxWidth: 300 });

            var name = props[pcfg.titleField];
            if (name) {
              searchIndex.push({ name: String(name), type: type, latlng: latlng, layerId: layerCfg.id, layer: marker });
            }

            if (!typeGroups[type]) { typeGroups[type] = L.featureGroup(); enabledTypes[type] = true; }
            typeGroups[type].addLayer(marker);
          });

          Object.keys(typeGroups).forEach(function (t) { parent.addLayer(typeGroups[t]); });

          overlayLayers[layerCfg.id] = parent;
          layerMeta[layerCfg.id] = { categorized: true, parent: parent, typeGroups: typeGroups, enabledTypes: enabledTypes };
          if (layerCfg.visible !== false) parent.addTo(map);
          return;
        }

        var gl = L.geoJSON(geojson, {
          pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng, {
              radius: 8,
              fillColor: layerCfg.color,
              color: "#ffffff",
              weight: 2,
              opacity: 1,
              fillOpacity: 0.9
            });
          },
          onEachFeature: function (feature, lyr) {
            lyr.bindPopup(buildPopupHtml(feature.properties || {}, pcfg), { maxWidth: 300 });
            var name = (feature.properties || {})[pcfg.titleField];
            var ll = lyr.getLatLng ? lyr.getLatLng() : (lyr.getBounds && lyr.getBounds().getCenter());
            if (name && ll) {
              searchIndex.push({
                name: String(name),
                type: (feature.properties || {})[pcfg.typeField] || layerCfg.name,
                latlng: ll,
                layerId: layerCfg.id,
                layer: lyr
              });
            }
          }
        });
        overlayLayers[layerCfg.id] = gl;
        if (layerCfg.visible !== false) gl.addTo(map);
      })
      .catch(function (err) {
        console.error("Не удалось загрузить слой", layerCfg.id, err);
        overlayLayers[layerCfg.id] = null;
      });
  });

  Promise.all(loadPromises).then(function () {
    buildLayerControls();
  });

  // ---------- UI: слои ----------
  function buildLayerControls() {
    var box = document.getElementById("layer-list");
    box.innerHTML = "";
    cfg.layers.forEach(function (layerCfg) {
      var gl = overlayLayers[layerCfg.id];
      var hasLegend = !!(layerCfg.marker && layerCfg.marker.shape === "star" && layerCfg.marker.colors);

      var item = document.createElement("div");
      item.className = "layer-item";

      var row = document.createElement("div");
      row.className = "control-item layer-row";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = gl ? map.hasLayer(gl) : false;
      input.disabled = !gl;
      input.addEventListener("change", function () {
        if (!gl) return;
        if (input.checked) gl.addTo(map); else map.removeLayer(gl);
      });

      var span = document.createElement("span");
      span.className = "layer-name";
      span.textContent = layerCfg.name + (gl ? "" : " (ошибка загрузки)");

      row.appendChild(input);
      // Категоризированный слой не имеет одного цвета — кружок не показываем
      if (!hasLegend) {
        var swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = layerCfg.color;
        row.appendChild(swatch);
      }
      row.appendChild(span);

      var meta = layerMeta[layerCfg.id];
      if (hasLegend && meta && meta.categorized) {
        var caret = document.createElement("span");
        caret.className = "legend-caret";
        caret.textContent = "▸";
        row.appendChild(caret);

        var legend = document.createElement("div");
        legend.className = "layer-legend";

        Object.keys(meta.typeGroups).sort().forEach(function (type) {
          var color = (layerCfg.marker.colors && layerCfg.marker.colors[type]) || layerCfg.marker.defaultColor;
          var li = document.createElement("label");
          li.className = "legend-item";

          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = meta.enabledTypes[type] !== false;
          cb.addEventListener("change", function () {
            meta.enabledTypes[type] = cb.checked;
            var grp = meta.typeGroups[type];
            if (cb.checked) meta.parent.addLayer(grp);
            else meta.parent.removeLayer(grp);
          });

          var sw = document.createElement("span");
          sw.className = "legend-star";
          sw.innerHTML = starSvg(color, 16);

          var tx = document.createElement("span");
          tx.textContent = type;

          li.appendChild(cb);
          li.appendChild(sw);
          li.appendChild(tx);
          legend.appendChild(li);
        });

        var toggle = function () {
          var open = item.classList.toggle("legend-open");
          caret.textContent = open ? "▾" : "▸";
        };
        span.addEventListener("click", toggle);
        caret.addEventListener("click", toggle);
        span.style.cursor = "pointer";

        item.appendChild(row);
        item.appendChild(legend);
      } else {
        span.addEventListener("click", function () {
          if (!input.disabled) { input.checked = !input.checked; input.dispatchEvent(new Event("change")); }
        });
        item.appendChild(row);
      }

      box.appendChild(item);
    });
  }

  // ---------- Попап ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function buildPopupHtml(props, pcfg) {
    pcfg = pcfg || POPUP;
    var title = props[pcfg.titleField];
    var type = props[pcfg.typeField];
    var desc = props[pcfg.descriptionField];
    var photo = props[pcfg.photoField];
    var labels = pcfg.fieldLabels || {};
    var reserved = [pcfg.titleField, pcfg.typeField, pcfg.descriptionField, pcfg.photoField];

    var html = '<div class="feature-popup">';
    if (photo) html += '<img src="' + escapeHtml(photo) + '" alt="' + escapeHtml(title || "") + '" loading="lazy" />';
    html += '<div class="pp-body">';
    if (type) html += '<span class="pp-type">' + escapeHtml(type) + "</span>";
    if (title) html += "<h3>" + escapeHtml(title) + "</h3>";
    if (desc) html += '<p class="pp-desc">' + escapeHtml(desc) + "</p>";

    if (!pcfg.hideAttributes) {
      var rows = "";
      Object.keys(props).forEach(function (key) {
        if (reserved.indexOf(key) !== -1) return;
        var val = props[key];
        if (val === null || val === undefined || val === "") return;
        var label = labels[key] || key;
        rows += "<tr><td>" + escapeHtml(label) + "</td><td>" + escapeHtml(val) + "</td></tr>";
      });
      if (rows) html += "<table>" + rows + "</table>";
    }

    var slots = pcfg.photoSlots || 0;
    if (slots > 0) {
      html += '<div class="pp-photos">';
      for (var i = 0; i < slots; i++) {
        html += '<div class="pp-photo-slot"><span>Фото ' + (i + 1) + "</span></div>";
      }
      html += "</div>";
    }

    html += "</div></div>";
    return html;
  }

  // ---------- Поиск ----------
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");

  input.addEventListener("input", function () {
    var q = input.value.trim().toLowerCase();
    results.innerHTML = "";
    if (!q) return;
    var matches = searchIndex
      .filter(function (it) { return it.name.toLowerCase().indexOf(q) !== -1; })
      .slice(0, 8);
    matches.forEach(function (it) {
      var li = document.createElement("li");
      li.innerHTML = escapeHtml(it.name) + "<small>" + escapeHtml(it.type) + "</small>";
      li.addEventListener("click", function () {
        var gl = overlayLayers[it.layerId];
        if (gl && !map.hasLayer(gl)) {
          gl.addTo(map);
          buildLayerControls();
        }
        map.flyTo(it.latlng, Math.max(map.getZoom(), 11));
        it.layer.openPopup();
        results.innerHTML = "";
        input.value = it.name;
      });
      results.appendChild(li);
    });
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-box")) results.innerHTML = "";
  });

  // ---------- Вкладки сайдбара ----------
  var tabBtns = document.querySelectorAll(".tab-btn");
  var tabContents = document.querySelectorAll(".tab-content");
  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.getAttribute("data-tab");
      tabBtns.forEach(function (b) { b.classList.toggle("active", b === btn); });
      tabContents.forEach(function (c) {
        c.classList.toggle("active", c.getAttribute("data-tab") === name);
      });
    });
  });

  // ============================================================
  //  Картографическая основа: слои OpenStreetMap через Overpass
  // ============================================================
  var osmCfg = cfg.osmLayers || [];
  var osmEndpoint = cfg.overpassEndpoint || "https://overpass-api.de/api/interpreter";
  var osmState = {}; // id -> {enabled, group, controller, statusEl}

  function osmStyle(layerCfg) {
    if (layerCfg.geom === "line") {
      return { color: layerCfg.color, weight: 2, opacity: 0.9 };
    }
    if (layerCfg.geom === "polygon") {
      return { color: layerCfg.color, weight: 1, opacity: 0.9, fillColor: layerCfg.color, fillOpacity: 0.25 };
    }
    return {};
  }

  function buildOsmPopup(props) {
    props = props || {};
    var title = props.name || props["name:ru"] || "Объект OSM";
    var html = '<div class="feature-popup"><div class="pp-body">';
    html += "<h3>" + escapeHtml(title) + "</h3>";
    var rows = "";
    Object.keys(props).forEach(function (key) {
      if (key.charAt(0) === "@" || key === "name") return;
      var val = props[key];
      if (val === null || val === undefined || val === "") return;
      rows += "<tr><td>" + escapeHtml(key) + "</td><td>" + escapeHtml(val) + "</td></tr>";
    });
    if (rows) html += "<table>" + rows + "</table>";
    html += "</div></div>";
    return html;
  }

  function setOsmStatus(layerCfg, text) {
    var st = osmState[layerCfg.id];
    if (st && st.statusEl) st.statusEl.textContent = text ? "— " + text : "";
  }

  function fetchOsmLayer(layerCfg) {
    var st = osmState[layerCfg.id];
    if (!st || !st.enabled) return;

    if (map.getZoom() < layerCfg.minZoom) {
      st.group.clearLayers();
      setOsmStatus(layerCfg, "приблизьте (зум " + layerCfg.minZoom + "+)");
      return;
    }

    var b = map.getBounds();
    var bbox = b.getSouth().toFixed(5) + "," + b.getWest().toFixed(5) + "," +
               b.getNorth().toFixed(5) + "," + b.getEast().toFixed(5);
    var ql = "[out:json][timeout:30][bbox:" + bbox + "];(" + layerCfg.query.join("") + ");out geom;";

    if (st.controller) st.controller.abort();
    st.controller = ("AbortController" in window) ? new AbortController() : null;

    setOsmStatus(layerCfg, "загрузка…");
    fetch(osmEndpoint, {
      method: "POST",
      body: "data=" + encodeURIComponent(ql),
      signal: st.controller ? st.controller.signal : undefined
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Overpass HTTP " + r.status);
        return r.json();
      })
      .then(function (osm) {
        if (!st.enabled) return;
        var geojson = window.osmtogeojson(osm);
        st.group.clearLayers();
        var gl = L.geoJSON(geojson, {
          pane: "osmOverlay",
          style: osmStyle(layerCfg),
          pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng, {
              pane: "osmOverlay",
              radius: 6, fillColor: layerCfg.color, color: "#fff",
              weight: 1.5, opacity: 1, fillOpacity: 0.9
            });
          },
          onEachFeature: function (feature, lyr) {
            lyr.bindPopup(buildOsmPopup(feature.properties), { maxWidth: 300 });
          }
        });
        st.group.addLayer(gl);
        setOsmStatus(layerCfg, (geojson.features ? geojson.features.length : 0) + " об.");
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        console.error("OSM слой", layerCfg.id, err);
        setOsmStatus(layerCfg, "ошибка загрузки");
      });
  }

  function buildOsmControls() {
    var box = document.getElementById("osm-layer-list");
    if (!box) return;
    box.innerHTML = "";
    osmCfg.forEach(function (layerCfg) {
      var group = L.layerGroup();
      osmState[layerCfg.id] = { enabled: false, group: group, controller: null, statusEl: null };

      var label = document.createElement("label");
      label.className = "control-item";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", function () {
        var st = osmState[layerCfg.id];
        st.enabled = input.checked;
        if (input.checked) {
          group.addTo(map);
          fetchOsmLayer(layerCfg);
        } else {
          if (st.controller) st.controller.abort();
          map.removeLayer(group);
          group.clearLayers();
          setOsmStatus(layerCfg, "");
        }
      });

      var swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = layerCfg.color;
      if (layerCfg.geom === "line") { swatch.style.borderRadius = "2px"; swatch.style.height = "4px"; }

      var span = document.createElement("span");
      span.textContent = layerCfg.name;

      var status = document.createElement("small");
      status.className = "osm-item-status";

      label.appendChild(input);
      label.appendChild(swatch);
      label.appendChild(span);
      label.appendChild(status);
      box.appendChild(label);

      osmState[layerCfg.id].statusEl = status;
    });
  }

  buildOsmControls();

  // Перезагрузка включённых OSM-слоёв при перемещении карты (с дебаунсом)
  var osmMoveTimer = null;
  map.on("moveend", function () {
    if (osmMoveTimer) clearTimeout(osmMoveTimer);
    osmMoveTimer = setTimeout(function () {
      osmCfg.forEach(function (layerCfg) {
        if (osmState[layerCfg.id] && osmState[layerCfg.id].enabled) fetchOsmLayer(layerCfg);
      });
    }, 700);
  });
})();
