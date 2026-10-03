/**
 * Bundled city photos (public/cities/<id>.jpg, ids from data/cities.json) and their credits.
 * Full list with sources: public/cities/CREDITS.md. lib/photos.test.ts asserts every seed city and
 * airport code in data/cities.json resolves to a bundled, credited file.
 */
export type PhotoCredit = { author: string; license: string; source: string };

const CREDITS: Record<string, PhotoCredit> = {
  rome: { author: "Diliff", license: "CC BY-SA 2.5", source: "https://commons.wikimedia.org/wiki/File:Colosseum_in_Rome-April_2007-1-_copie_2B.jpg" },
  milan: { author: "Steffen Schmitz", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Milano,_Duomo_with_Milan_Cathedral_and_Galleria_Vittorio_Emanuele_II,_2016.jpg" },
  naples: { author: "MM", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:NapoliPanoramaDaSanMartino.jpg" },
  venice: { author: "Saffron Blaze", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Rialto_Gondoliers.jpg" },
  catania: { author: "Auregann", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Catania,_Ognina_with_view_on_the_Etna.jpg" },
  barcelona: { author: "Jorge Franganillo", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Park_G%C3%BCell_-_50030738311.jpg" },
  madrid: { author: "Felipe Gabaldón", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Gran_V%C3%ADa_(Madrid)_1.jpg" },
  malaga: { author: "Benjamin Smith", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:M%C3%A1laga_-_View_of_the_port_from_Alacazaba.jpg" },
  valencia: { author: "Diego Delso", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Museo_Pr%C3%ADncipe_Felipe,_Ciudad_de_las_Artes_y_las_Ciencias,_Valencia,_Espa%C3%B1a,_2014-06-29,_DD_59.JPG" },
  palma: { author: "Heuschrecke (Dmitry Tonkonog and Ksenia Fedosova)", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Palma_de_Mallorca_cathedral_view_from_west.JPG" },
  tenerife: { author: "Thomas Wolf, www.foto-tw.de", license: "CC BY-SA 3.0 de", source: "https://commons.wikimedia.org/wiki/File:Roque_Cinchado_mit_Teide.jpg" },
  lisbon: { author: "Jakub Hałun", license: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:View_from_Miradouro_de_Santa_Luzia,_Lisbon,_20250603_2015_9043.jpg" },
  porto: { author: "Michael Gaylard", license: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:A_vibrant_panorama_of_Porto,_Portugal,_showcasing_the_Douro_River,_historic_Ribeira_district,_and_the_Dom_Lu%C3%ADs_I_Bridge._(55247151390).jpg" },
  funchal: { author: "Dietmar Rabich", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Funchal_(Madeira,_Portugal),_Ortsansicht_--_2025_--_1307.jpg" },
  paris: { author: "Getfunky Paris", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Eiffel_Tower_and_Pont_Alexandre_III_at_night.jpg" },
  nice: { author: "Tobi 87", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Nizza-C%C3%B4te_d%27Azur.jpg" },
  amsterdam: { author: "Basile Morin", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Colorful_windows_and_canal_houses_at_blue_hour_with_water_reflection_in_Damrak_Amsterdam_Netherlands.jpg" },
  berlin: { author: "Thomas Wolf, www.foto-tw.de", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Brandenburger_Tor_morgens.jpg" },
  munich: { author: "Martin Falbisoner", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Frauenkirche_and_Neues_Rathaus_Munich_March_2013.JPG" },
  vienna: { author: "Manfred Werner - Tsui", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Wien_Stephansdom_Augustinerkirche_Riesenrad_2012.jpg" },
  innsbruck: { author: "Weissbier1328 at German Wikipedia", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Nordkette_vom_Innsbrucker_Marktplatz_gesehen.jpg" },
  prague: { author: "Ввласенко", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Vltava_in_Prague_at_sunset.jpg" },
  budapest: { author: "Godot13", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:HUN-2015-Budapest-Hungarian_Parliament_(Budapest)_2015-02.jpg" },
  athens: { author: "A.Savin", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Attica_06-13_Athens_50_View_from_Philopappos_-_Acropolis_Hill.jpg" },
  heraklion: { author: "Moonik", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Venetian_Fortress_of_Koules_in_Heraklion,_Crete_004.jpg" },
  split: { author: "Bernard Gagnon", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:View_of_Diocletian%27s_Palace,_Split_01.jpg" },
  dubrovnik: { author: "Diego Delso", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Casco_viejo_de_Dubrovnik,_Croacia,_2014-04-14,_DD_04.JPG" },
  valletta: { author: "Paul Stephenson", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Valletta,_Malta_(139830665).jpg" },
  copenhagen: { author: "Jakub Hałun", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Nyhavn,_Copenhagen,_20220618_1728_7354.jpg" },
  stockholm: { author: "Julian Herzog", license: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:Skeppsbrokajen_Gamla_Stan_from_Skeppsholmen_Stockholm_2016_01.jpg" },
  oslo: { author: "Christian David", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Oslo_Opera_House_(Den_Norske_Opera_%26_Ballett),_Norway.jpg" },
  reykjavik: { author: "Diego Delso", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Calle_Sk%C3%B3lav%C3%B6r%C3%B0ust%C3%ADgur,_Reikiavik,_Distrito_de_la_Capital,_Islandia,_2014-08-13,_DD_111.jpg" },
  dublin: { author: "Robert Linsdell", license: "CC BY 2.0", source: "https://commons.wikimedia.org/wiki/File:Ha%27penny_Bridge_%26_River_Liffey,_Dublin_(507186)_(32512892980).jpg" },
  larnaca: { author: "Qasinka", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:2022_03_Hala_Sultan_Tekke_1.jpg" },
  london: { author: "Bjørn Erik Pedersen", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Big_Ben_at_sunrise,_2016.jpg" },
  // Not in data/cities.json, but the backend scorer's catalogue (scoring/provider.py) can return it.
  edinburgh: { author: "Saffron Blaze", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Edinburgh_Castle_Rock.jpg" },
  tirana: { author: "Pudelek", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Tirana_-_Skanderbeg_Square_(Sheshi_Sk%C3%ABnderbej)_-_by_Pudelek.jpg" },
};

/** Destination IATA (city code and every airport) → photo id. */
const BY_IATA: Record<string, string> = {
  FCO: "rome",
  CIA: "rome",
  MXP: "milan",
  BGY: "milan",
  LIN: "milan",
  NAP: "naples",
  VCE: "venice",
  TSF: "venice",
  CTA: "catania",
  BCN: "barcelona",
  MAD: "madrid",
  AGP: "malaga",
  VLC: "valencia",
  PMI: "palma",
  TFS: "tenerife",
  TFN: "tenerife",
  LIS: "lisbon",
  OPO: "porto",
  FNC: "funchal",
  CDG: "paris",
  ORY: "paris",
  BVA: "paris",
  NCE: "nice",
  AMS: "amsterdam",
  EIN: "amsterdam",
  BER: "berlin",
  MUC: "munich",
  VIE: "vienna",
  INN: "innsbruck",
  PRG: "prague",
  BUD: "budapest",
  ATH: "athens",
  HER: "heraklion",
  SPU: "split",
  DBV: "dubrovnik",
  MLA: "valletta",
  CPH: "copenhagen",
  ARN: "stockholm",
  OSL: "oslo",
  KEF: "reykjavik",
  DUB: "dublin",
  LCA: "larnaca",
  PFO: "larnaca",
  STN: "london",
  LHR: "london",
  LGW: "london",
  LTN: "london",
  TIA: "tirana",
  EDI: "edinburgh",
};
function photoId(iata: string): string | undefined {
  return BY_IATA[iata.toUpperCase()];
}

export function cityPhoto(iata: string): string | null {
  const id = photoId(iata);
  return id ? `/cities/${id}.jpg` : null;
}

export function cityPhotoCredit(iata: string): PhotoCredit | null {
  const id = photoId(iata);
  return id ? CREDITS[id] : null;
}

/**
 * Illustrated fallback for a city without a bundled photo: a dusk sky whose hue is derived from the
 * city name (stable across renders), so unknown destinations never show a blank card.
 */
export function fallbackHue(city: string): number {
  let h = 0;
  for (const ch of city) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}
