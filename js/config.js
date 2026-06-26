/*
 * Конфигурация портала. Чтобы сделать новый геопортал на этом же движке,
 * достаточно заменить значения здесь и положить свои GeoJSON в папку data/.
 */
window.PORTAL_CONFIG = {
  // Начальный вид карты
  map: {
    center: [55.5, 159.5], // [lat, lng] — Камчатка
    zoom: 6,
    minZoom: 3,
    maxZoom: 18
  },

  // Подложки (базовые слои). Первая с default: true включается по умолчанию.
  basemaps: [
    {
      id: "osm",
      name: "OpenStreetMap",
      default: true,
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenStreetMap contributors"
    },
    {
      id: "topo",
      name: "Рельеф (OpenTopoMap)",
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenTopoMap (CC-BY-SA), &copy; OpenStreetMap",
      maxZoom: 17
    },
    {
      id: "esri-sat",
      name: "Спутник (ESRI)",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
    }
  ],

  // Тематические слои. geojson — путь к файлу в data/.
  // color — цвет маркеров; visible — включён ли слой при загрузке.
  layers: [
    {
      id: "geology",
      name: "Геология Камчатки",
      geojson: "data/geology.geojson",
      geom: "polygon",
      color: "#9c7a5b",
      visible: false,
      // Полигоны раскрашиваются по основному классу SOIL0 (авто-палитра + легенда).
      // legendPrefix — подпись перед кодом класса в легенде/чекбоксах.
      marker: {
        shape: "polygon",
        colorField: "SOIL0",
        legendPrefix: "Класс ",
        fillOpacity: 0.55,
        defaultColor: "#888888"
      },
      // Поля попапа для полигонов геологии
      popup: {
        titleField: "POLIGON_ID",
        fieldLabels: {
          POLIGON_ID: "ID полигона",
          SOIL0: "Класс (осн.)",
          SOIL1: "Класс (доп. 1)",
          SOIL2: "Класс (доп. 2)",
          SOIL3: "Класс (доп. 3)",
          PARENT1: "Материнская порода 1",
          PARENT2: "Материнская порода 2"
        }
      }
    },
    {
      id: "volcanoes",
      name: "Вулканы (GVP)",
      geojson: "data/volcanoes.geojson",
      color: "#e8453c",
      visible: true,
      // Круговые маркеры с раскраской по статусу (действующий/потухший)
      marker: {
        shape: "circle",
        colorField: "type",
        defaultColor: "#e8453c",
        colors: {
          "Действующий вулкан": "#e8453c",
          "Потухший вулкан": "#8a96a3"
        }
      }
    },
    {
      id: "springs",
      name: "Термальные источники",
      geojson: "data/springs.geojson",
      color: "#58a6ff",
      visible: true
    },
    {
      id: "dostoprim",
      name: "Достопримечательности",
      geojson: "data/dostoprimechatelnosti.geojson",
      color: "#f6c343",
      visible: true,
      // Маркеры-звёзды, яркая раскраска по типу достопримечательности
      marker: {
        shape: "star",
        size: 24,
        colorField: "тип",
        defaultColor: "#ff4081",
        colors: {
          "Геоморфологические": "#ff1744",
          "Гидрологические": "#00b0ff",
          "Гидрогеологические": "#00e5ff",
          "Стратиграфические": "#ffea00",
          "Комплексные": "#d500f9",
          "Палеонтологические": "#76ff03",
          "Историко-геологические": "#ff9100",
          "Минералогические и петрографические": "#1de9b6"
        }
      },
      // Поля попапа для этого слоя (имена отличаются от слоёв по умолчанию)
      popup: {
        titleField: "Name",
        typeField: "тип",
        descriptionField: "подтип",
        photoField: "",
        hideAttributes: true, // скрыть таблицу остальных атрибутов
        photoSlots: 2,        // заготовка под N фотографий
        // Фото по точному имени объекта (путь относительно корня сайта)
        photos: {
          // Ранее предоставленные пользователем снимки (по два на объект)
          "Халактырский пляж": ["images/halaktyrsky_1.jpg", "images/halaktyrsky_2.jpg"],
          "Кратер вулкана Мутновский": ["images/mutnovsky_1.png", "images/mutnovsky_2.jpg"],
          "Дачные источники": ["images/dachnye_1.jpg", "images/dachnye_2.png"],
          "Кратер вулкана Горелый": ["images/gorely_1.jpg", "images/gorely_2.png"],
          "Острый толбачик": ["images/ostry_tolbachik_1.webp", "images/ostry_tolbachik_2.jpg"],
          "Северный прорыв гора Горшкова": ["images/severny_proryv_1.jpg", "images/severny_proryv_2.webp"],
          "Водопад Спокойный (Вилючинский)": ["images/vodopad_spokoyny_1.png", "images/vodopad_spokoyny_2.jpg"],
          "Скалы Три Брата": ["images/tri_brata_1.png", "images/tri_brata_2.jpg"],
          // Объекты, где 1-е фото — Wikimedia, 2-е фото — из присланного документа
          "Кальдера вулкана Ксудач": ["images/ksudach.jpg", "images/ksudach_2.jpeg"],
          "Горный массив Вачкажец": ["images/vachkazhets.jpg", "images/vachkazhets_2.jpeg"],
          "Долина Гейзеров": ["images/dolina_geyzerov.jpg", "images/dolina_geyzerov_2.jpeg"],
          "Вулкан Опала": ["images/opala.jpg", "images/opala_2.jpeg"],
          "Вулкан Безымянный": ["images/bezymyanny.jpg", "images/bezymyanny_2.jpeg"],
          "Вулкан Шивелуч": ["images/shiveluch.jpg", "images/shiveluch_2.jpeg"],
          "Ключевская сопка": ["images/klyuchevskaya.jpg", "images/klyuchevskaya_2.jpeg"],
          "Кратерное озеро вулкана Малый Семячик": ["images/maly_semyachik.jpg", "images/maly_semyachik_2.jpeg"],
          "Налычевские горячие источники": ["images/nalychevo.jpg", "images/nalychevo_2.jpeg"],
          "Влк Хангар": ["images/khangar.jpg", "images/khangar_2.jpeg"],
          // Снимки из присланного документа (по два на объект, если не указано иное)
          "Гремучие ключи (Гремучие парогидротермы)": ["images/gremuchie_klyuchi_1.jpeg", "images/gremuchie_klyuchi_2.jpeg"],
          "Кухтины Баты": ["images/kuhtiny_baty_1.jpeg", "images/kuhtiny_baty_2.jpeg"],
          "Ходуткинские горячие источники": ["images/hodutkinskie_1.jpeg", "images/hodutkinskie_2.jpeg"],
          "Саванские горячие источники": ["images/savanskie_1.jpeg", "images/savanskie_2.jpeg"],
          "Жировские источники": ["images/zhirovskie_1.jpeg", "images/zhirovskie_2.jpeg"],
          "Нижне-Опалинские минеральные источники": ["images/nizhne_opalinskie_1.jpeg", "images/nizhne_opalinskie_2.jpeg"],
          "Верхне Опалинские горячие источники": ["images/verhne_opalinskie_1.jpeg"],
          "Редкие ландшафты Вилючика": ["images/redkie_landshafty_viluchika_1.jpeg", "images/redkie_landshafty_viluchika_2.jpeg"],
          "Карымшинские горячие источники": ["images/karymshinskie_1.jpeg", "images/karymshinskie_2.png"],
          "Гора Бабий Камень": ["images/babiy_kamen_1.png", "images/babiy_kamen_2.png"],
          "Зайкин мыс": ["images/zaykin_mys_1.jpeg", "images/zaykin_mys_2.jpeg"],
          "Голубые озера": ["images/golubye_ozera_1.jpeg", "images/golubye_ozera_2.jpeg"],
          "Никольская сопка": ["images/nikolskaya_sopka_1.jpeg", "images/nikolskaya_sopka_2.jpeg"],
          "Озеро Дальнее": ["images/ozero_dalnee_1.jpeg", "images/ozero_dalnee_2.jpeg"],
          "Бараньи скалы": ["images/barani_skaly_1.jpeg", "images/barani_skaly_2.jpeg"],
          "Экструзия Верблюд": ["images/ekstruziya_verblyud_1.jpeg", "images/ekstruziya_verblyud_2.jpeg"],
          "Тимоновские горячие ключи": ["images/timonovskie_1.jpeg", "images/timonovskie_2.jpeg"],
          "Вулкан Бакйнинг": ["images/bakening_1.jpeg", "images/bakening_2.jpeg"],
          "Озеро Карымское": ["images/ozero_karymskoe_1.jpeg", "images/ozero_karymskoe_2.jpeg"],
          "Оганчинские минеральные источники": ["images/oganchinskie_1.jpeg", "images/oganchinskie_2.jpeg"],
          "Южный прорыв": ["images/yuzhny_proryv_1.png", "images/yuzhny_proryv_2.png"],
          "Вулкан Камень": ["images/vulkan_kamen_1.jpeg", "images/vulkan_kamen_2.jpeg"],
          "Кратер Звезда": ["images/krater_zvezda_1.png", "images/krater_zvezda_2.png"],
          "Вулкан Ушковский": ["images/ushkovsky_1.jpeg", "images/ushkovsky_2.jpeg"],
          "Вулкан Крестовский": ["images/krestovsky_1.jpeg", "images/krestovsky_2.jpeg"],
          "Голыгинские горячие источники": ["images/golyginskie_1.jpeg"],
          "Озеро Двухюрточное": ["images/ozero_dvuhyurtochnoe_1.jpeg"],
          "Двухюрточные Геотермальные источники": ["images/dvuhyurtochnye_geo_1.jpeg"],
          "Остров Птичий": ["images/ostrov_ptichiy_1.png", "images/ostrov_ptichiy_2.png"],
          "Озеро Паланское": ["images/ozero_palanskoe_1.jpeg", "images/ozero_palanskoe_2.jpeg"],
          "Паланские пороги": ["images/palanskie_porogi_1.jpeg", "images/palanskie_porogi_2.jpeg"],
          "Аметисты мыса кинкель": ["images/ametisty_kinkel_1.jpeg", "images/ametisty_kinkel_2.jpeg"],
          "Остров Карагинский": ["images/ostrov_karaginsky_1.png", "images/ostrov_karaginsky_2.jpeg"],
          "Бухта Буян": ["images/buhta_buyan_1.jpeg", "images/buhta_buyan_2.jpeg"],
          "Арка Стеллара": ["images/arka_stellara_1.jpeg", "images/arka_stellara_2.jpeg"],
          "Бухта Командор": ["images/buhta_komandor_1.jpeg", "images/buhta_komandor_2.jpeg"]
        },
        // Текстовые пометки вместо фото (по слотам). Показываются, когда снимка нет.
        // Если у объекта нет фото вообще — выводится одна пометка на всю карточку.
        notes: {
          "Ключ Карымайский": ["Существующих изображений нет."],
          "Кратер «Горячая»": ["Достоверных изображений нет."],
          "Точилинский разрез": ["Достоверных снимков нет."],
          "Останцы выветривания": ["Существующих изображений нет."],
          // Первое фото есть, для второго слота — пометка
          "Верхне Опалинские горячие источники": [null, "Других изображений нет."]
        }
      }
    }
  ],

  // Картографическая основа из OpenStreetMap (через публичный Overpass API).
  // Слои подгружаются по видимой области карты при zoom >= minZoom.
  // geom: "line" | "polygon" | "point" — влияет на стиль отрисовки.
  // query: массив фрагментов Overpass QL (bbox добавляется автоматически).
  // Зеркало Overpass. maps.mail.ru стабильно доступно из РФ; зарубежные зеркала
  // (overpass-api.de и др.) могут быть недоступны. Можно заменить при необходимости.
  overpassEndpoint: "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  osmLayers: [
    {
      id: "osm-water", name: "Вода", geom: "polygon", color: "#4a90d9", minZoom: 10,
      query: ['way["natural"="water"];', 'relation["natural"="water"];', 'way["waterway"="riverbank"];', 'way["waterway"~"river|stream|canal"];']
    },
    {
      id: "osm-vegetation", name: "Растительность", geom: "polygon", color: "#6aa84f", minZoom: 11,
      query: ['way["natural"~"wood|scrub|heath|grassland"];', 'relation["natural"~"wood|scrub"];', 'way["landuse"~"forest|meadow"];']
    },
    {
      id: "osm-landuse", name: "Землепользование", geom: "polygon", color: "#caa472", minZoom: 12,
      query: ['way["landuse"];']
    },
    {
      id: "osm-protected", name: "ООПТ / заповедники", geom: "polygon", color: "#38a169", minZoom: 8,
      query: ['relation["boundary"="protected_area"];', 'way["boundary"="protected_area"];', 'relation["leisure"="nature_reserve"];', 'way["leisure"="nature_reserve"];']
    },
    {
      id: "osm-admin", name: "Административные границы", geom: "polygon", color: "#a05195", minZoom: 7,
      query: ['relation["boundary"="administrative"]["admin_level"~"4|6|8"];']
    },
    {
      id: "osm-highway", name: "Автодороги", geom: "line", color: "#e67e22", minZoom: 11,
      query: ['way["highway"];']
    },
    {
      id: "osm-railway", name: "Железные дороги", geom: "line", color: "#555555", minZoom: 10,
      query: ['way["railway"~"rail|light_rail|subway|tram|narrow_gauge"];']
    },
    {
      id: "osm-power", name: "Линии электропередачи", geom: "line", color: "#c0392b", minZoom: 12,
      query: ['way["power"="line"];', 'way["power"="minor_line"];']
    },
    {
      id: "osm-buildings", name: "Здания", geom: "polygon", color: "#8d6e63", minZoom: 15,
      query: ['way["building"];', 'relation["building"];']
    },
    {
      id: "osm-places", name: "Населённые пункты", geom: "point", color: "#d81b60", minZoom: 6,
      query: ['node["place"~"city|town|village|hamlet"];']
    },
    {
      id: "osm-poi", name: "Точки интереса (POI)", geom: "point", color: "#3949ab", minZoom: 13,
      query: ['node["tourism"];', 'node["amenity"];', 'node["natural"="peak"];']
    }
  ],

  // Какие свойства показывать в попапе и как их подписывать.
  // Поле, заданное в titleField — заголовок; typeField — подпись-бейдж;
  // descriptionField — текст; photoField — ссылка/путь к фото.
  // Все остальные свойства попадут в таблицу атрибутов (кроме служебных ниже).
  popup: {
    titleField: "name",
    typeField: "type",
    descriptionField: "description",
    photoField: "photo",
    // человекочитаемые подписи для таблицы атрибутов
    fieldLabels: {
      height: "Высота, м",
      status: "Статус",
      last_eruption: "Последнее извержение",
      temperature: "Температура, °C",
      source: "Источник",
      gvp_name: "Название (GVP)",
      gvp_id: "Номер GVP",
      gvp_class: "Класс (исходный)",
      "примечание": "Примечание"
    }
  }
};
