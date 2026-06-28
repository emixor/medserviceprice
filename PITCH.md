# 🎤 The Winning Pitch Script — MedServicePrice.kz
### Питч-скрипт / Pitch Script · 3–5 minutes · Bilingual (EN + RU)

> **How to use this document.** Below are two complete, standalone, word-for-word pitch scripts — one in English, one in Russian. Each is timed for a 3:30–4:00 live delivery and divided into five tactical phases. Stage directions are in `[brackets]`. Pick the language of your audience and read it top to bottom.
>
> **Как пользоваться этим документом.** Ниже — два полноценных питч-скрипта от первого до последнего слова: один на английском, один на русском. Каждый рассчитан на живую подачу 3:30–4:00 и разбит на пять тактических фаз. Ремарки — в `[квадратных скобках]`. Выберите язык аудитории и читайте сверху донизу.

---

# 🇬🇧 ENGLISH PITCH SCRIPT

*Estimated delivery time: 3 minutes 40 seconds at a confident, deliberate pace.*

---

### Phase 1 — The Hook & Dramatic Opening (0:00 – 0:45)

`[Walk to center stage. Hold up a single printed lab receipt. Pause two full seconds before speaking.]`

Imagine you live in Almaty. Your doctor hands you a prescription for a standard blood panel — a Complete Blood Count, a glucose test, a thyroid check. Three routine tests. You call the first lab: four thousand tenge. You call the second, four blocks away: seven thousand. The third — same street, same day — fifteen thousand eight hundred. **The same three tests. Four times the price.**

`[Lower the receipt. Look at the panel.]`

You just spent three hours on the phone, you still don't know if you overpaid, and nobody in this country can tell you the answer — because there is no single place where Kazakhstan's medical prices live. They are scattered across seventy different clinic websites, locked inside PDFs, buried in Excel exports, written in three different languages. Every patient re-discovers the chaos alone. Every month. For the rest of their life.

That is not a minor inconvenience. That is a daily tax on the sickest, the poorest, and the most afraid. And today I am going to show you the end of it.

`[Click — Slide 1: title appears.]`

---

### Phase 2 — The Solution & Technical Triumph (0:45 – 1:45)

`[Advance to Slide 2 — the price-bar chart.]`

This is **MedServicePrice.kz** — Aviasales for medicine. We crawl every public clinic and lab-chain price list in Kazakhstan, normalize it into one canonical catalog, and let any patient compare prices in under a second. Free.

But the real story is not the website. The real story is the engineering problem we had to solve to build it. Because here's the thing — those seventy sources don't agree on anything. One clinic writes "ОАК". Another writes "CBC". A third writes "Общий анализ крови". A fourth writes it in Kazakh — "Жалпы қан талдауы". **Four strings, one test.** A naive keyword search returns nothing.

`[Advance to Slide 3 — architecture flow.]`

So we built a non-blocking background extraction layer — seventy independent scrapers, each fault-isolated, each with retry, exponential backoff, and a fifteen-second timeout. One source failing never blocks another. The raw data lands in an immutable raw layer, retained for ninety days for full auditability.

`[Advance to Slide 4 — normalization.]`

Then comes the heart of the system — our hybrid normalization engine. Token-set ratio for fuzzy matching. Levenshtein distance for typos. Cyrillic-to-Latin transliteration so "ОАК" and "CBC" meet in the middle. A synonym dictionary. And a confidence threshold of zero-point-eight: anything above auto-maps to the catalog; anything below goes to a review queue for a human or an AI second pass. The result? **Over ninety percent of three thousand seven hundred raw strings map automatically** — and the ones that don't, we know about.

---

### Phase 3 — The Live Demo Walkthrough (1:45 – 3:00)

`[Advance to Slide 5 — metrics. Then switch to the live site.]`

Let me show you what that looks like for a real patient.

`[Open the live site. Type "кальций" into the search box.]`

I search for "calcium" — in Russian, because that's how my doctor wrote it. In under one second, I get fifty-two clinics, sorted by price, with the cheapest at three thousand tenge and the most expensive at almost sixteen thousand. **A five-times gap, on one screen, in one second.**

`[Click "Compare" — open the Smart Basket.]`

But here's where it gets interesting. I don't just want one test — my prescription has five. I drop all five into the Smart Basket. The engine runs a traveling-purchaser optimization across clinics and returns the cheapest split, factoring **real travel distance from 2GIS** — because a clinic that saves me three hundred tenge but is twelve kilometers away is not actually cheaper.

`[Click the OCR icon — upload a prescription photo.]`

Now the magic. I photograph my handwritten prescription. `['Analyzing…']` Our vision-language model reads the Cyrillic and Latin drug names, maps each line to the service directory, and pre-fills the basket. **One photo, one tap, five tests compared across fifty clinics.** That is the wow factor.

`[Click the Price History tab.]`

And because every price change is versioned — fourteen thousand seven hundred history points and counting — I can see that this test got twelve percent more expensive in Almaty over the last ninety days, and cheaper in Shymkent. I can subscribe to a price-drop alert and get an email the moment it falls below my threshold.

---

### Phase 4 — Business Value & Localization (3:00 – 3:30)

`[Advance to Slide 6 — killer features. Then Slide 7 — differentiators.]`

Now you might ask — why hasn't someone done this before? Because Kazakhstan is not a market you can copy-paste a Western product into. You need **ОСМС** — the obligatory social-health-insurance coverage indicator on every service, so patients know what's free at the point of care. You need **2GIS distance metrics**, not Google. You need **three languages in the database itself**, not bolted on as a UI layer. And you need a business model that works when clinics won't share prices willingly — so we built **price-lock vouchers**, inspired by MDsave: a clinic freezes today's price for seven days, the patient books with certainty, and the clinic fills idle capacity. Win-win.

---

### Phase 5 — The Climax & Unforgettable Closing Statement (3:30 – 4:00)

`[Walk back to center. Slow down. Drop the energy from "sales" to "conviction."]`

Seventy clinics. One hundred seventy-eight services. Two thousand six hundred forty-three live prices. Twelve cities. Three languages. Sub-second search. And a normalization engine that turns chaos into a single source of truth — with over ninety percent confidence.

`[Pause two seconds. Make eye contact with the panel.]`

Every person in this room will, at some point, sit across from a doctor and hear a diagnosis. And in that moment, the last thing you should have to worry about is whether you're being overcharged for the blood test that confirms it. **Health is not a marketplace where ignorance should ever be the price of admission.** MedServicePrice.kz puts the price tag back where it belongs — in the patient's hand, before the decision, in a language they understand.

Thank you.

`[Hold eye contact three seconds. Nod. Exit.]`

---

*Word count: ~720 words · Target pace: 175 wpm → 4 min 7 s with pauses.*

---

---

# 🇷🇺 РУССКИЙ ПИТЧ-СКРИПТ

*Ожидаемое время подачи: 3 минуты 40 секунд при уверенном, размеренном темпе.*

---

### Фаза 1 — Крючок и драматическое открытие (0:00 – 0:45)

`[Выйти в центр сцены. Поднять один распечатанный чек из лаборатории. Выдержать две полные секунды паузы перед словами.]`

Представьте: вы живёте в Алматы. Врач выписывает вам направление на стандартную панель анализов — общий анализ крови, глюкозу, проверку щитовидки. Три рутинных теста. Вы звоните в первую лабораторию: четыре тысячи тенге. Звоните во вторую, через четыре квартала: семь тысяч. В третью — та же улица, тот же день — пятнадцать тысяч восемьсот. **Те же три анализа. Цена — в четыре раза выше.**

`[Опустить чек. Посмотреть на жюри.]`

Вы потратили три часа на телефон, вы всё ещё не знаете, переплатили ли, и никто в этой стране не может дать вам ответ — потому что в Казахстане нет единого места, где живут медицинские цены. Они разбросаны по семидесяти сайтам клиник, заперты в PDF, погребены в Excel, написаны на трёх разных языках. Каждый пациент заново открывает этот хаос. Один. Каждый месяц. Всю оставшуюся жизнь.

И это не мелкое неудобство. Это ежедневный налог на самых больных, самых бедных и самых напуганных. И сегодня я покажу вам, как это заканчивается.

`[Клик — Слайд 1: появляется титул.]`

---

### Фаза 2 — Решение и технический триумф (0:45 – 1:45)

`[Перейти к Слайду 2 — столбчатая диаграмма цен.]`

Это **MedServicePrice.kz** — Aviasales для медицины. Мы собираем прайс-листы всех публичных клиник и лабораторных сетей Казахстана, нормализуем их в один канонический каталог и даём любому пациенту сравнить цены меньше чем за секунду. Бесплатно.

Но настоящий сюжет — это не сайт. Настоящий сюжет — инженерная задача, которую пришлось решить, чтобы его построить. Потому что вот в чём дело — эти семьдесят источников ни в чём не сходятся. Одна клиника пишет «ОАК». Другая — «CBC». Третья — «Общий анализ крови». Четвёртая — на казахском: «Жалпы қан талдауы». **Четыре строки, один анализ.** Наивный поиск по ключевым словам не вернёт ничего.

`[Перейти к Слайду 3 — поток архитектуры.]`

Поэтому мы построили неблокирующий фоновый слой извлечения — семьдесят независимых скраперов, каждый с изоляцией по источнику, повторами, экспоненциальной задержкой и таймаутом пятнадцать секунд. Сбой одного источника никогда не блокирует остальные. Сырые данные попадают в неизменяемый raw-слой, хранящийся девяносто дней для полного аудита.

`[Перейти к Слайду 4 — нормализация.]`

А затем — сердце системы, наш гибридный движок нормализации. Token-set ratio для нечёткого сопоставления. Расстояние Левенштейна для опечаток. Транслитерация кириллица-в-латиницу, чтобы «ОАК» и «CBC» встретились посередине. Словарь синонимов. И порог уверенности ноль-восемь: всё выше автоматически маппится в каталог; всё ниже — уходит в очередь ревью для человека или ИИ. Результат? **Свыше девяноста процентов из трёх тысяч семисот сырых строк маппятся автоматически** — а те, что не маппятся, мы видим.

---

### Фаза 3 — Прохождение живого демо (1:45 – 3:00)

`[Перейти к Слайду 5 — метрики. Затем переключиться на живой сайт.]`

Покажу, как это выглядит для реального пациента.

`[Открыть живой сайт. Ввести «кальций» в строку поиска.]`

Я ищу «кальций» — на русском, потому что именно так его написал врач. Меньше чем за секунду я получаю пятьдесят две клиники, отсортированные по цене: от трёх тысяч тенге за самые дешёвые до почти шестнадцати тысяч за самые дорогие. **Разрыв в пять раз — на одном экране, за одну секунду.**

`[Кликнуть «Сравнить» — открыть Умную корзину.]`

Но вот где начинается самое интересное. Мне нужен не один анализ — в рецепте их пять. Я закидываю все пять в Умную корзину. Движок запускает оптимизацию задачи маршрутизации по клиникам и возвращает самый дешёвый сплит, учитывая **реальное расстояние по 2GIS** — потому что клиника, которая экономит мне триста тенге, но находится в двенадцати километрах, на самом деле не дешевле.

`[Кликнуть иконку OCR — загрузить фото рецепта.]`

А теперь — магия. Я фотографирую рукописный рецепт. `['Анализируем…']` Наша vision-language-модель читает названия препаратов на кириллице и латинице, маппит каждую строку в каталог услуг и автоматически заполняет корзину. **Одно фото, одно нажатие — пять анализов сравнены по пятидесяти клиникам.** Вот это и есть wow-фактор.

`[Перейти на вкладку «История цен».]`

И поскольку каждое изменение цены версонируется — четырнадцать тысяч семьсот точек истории и продолжает расти — я вижу, что за последние девяносто дней этот анализ в Алматы подорожал на двенадцать процентов, а в Шымкенте подешевел. Я могу подписаться на уведомление о снижении цены и получить email, как только она упадёт ниже моего порога.

---

### Фаза 4 — Бизнес-ценность и локализация (3:00 – 3:30)

`[Перейти к Слайду 6 — киллер-фичи. Затем Слайд 7 — отличия.]`

Теперь вы можете спросить — почему этого никто не сделал раньше? Потому что Казахстан — не рынок, на который можно скопировать западный продукт. Нужен **ОСМС** — индикатор покрытия обязательного соцмедстрахования на каждой услуге, чтобы пациент знал, что бесплатно в момент обращения. Нужны **метрики расстояния 2GIS**, а не Google. Нужны **три языка в самой базе**, а не слой перевода интерфейса, добавленный потом. И нужна бизнес-модель, работающая, когда клиники не хотят делиться ценами добровольно — поэтому мы построили **ваучеры фиксации цены** по образцу MDsave: клиника фиксирует сегодняшнюю цену на семь дней, пациент бронирует с уверенностью, а клиника заполняет простой. Win-win.

---

### Фаза 5 — Кульминация и незабываемая финальная фраза (3:30 – 4:00)

`[Вернуться в центр. Замедлить темп. Сменить энергию с «продажи» на «убеждённость».]`

Семьдесят клиник. Сто семьдесят восемь услуг. Две тысячи шестьсот сорок три живые цены. Двенадцать городов. Три языка. Поиск меньше секунды. И движок нормализации, который превращает хаос в единый источник истины — с уверенностью свыше девяноста процентов.

`[Пауза две секунды. Зрительный контакт с жюри.]`

Каждый человек в этом зале однажды сядет напротив врача и услышит диагноз. И в этот момент последнее, о чём вы должны беспокоиться, — не переплачиваете ли вы за анализ крови, который этот диагноз подтверждает. **Здоровье — не тот рынок, где незнание когда-либо должно быть ценой входа.** MedServicePrice.kz возвращает ценник туда, где ему место, — в руку пациента, до решения, на языке, который он понимает.

Спасибо.

`[Удерживать зрительный контакт три секунды. Кивок. Уйти.]`

---

*Объём: ~720 слов · Целевой темп: 175 слов/мин → 4 мин 7 с с паузами.*

---

## 📋 Delivery Notes / Ремарки для подачи

**EN**
- Phase 1: The opening receipt prop is non-negotiable — it grounds the abstract problem in a physical object. Hold it the entire first 45 seconds.
- Phase 2: Speed up slightly on the architecture flow. The judges are technical; let the numbers (70 scrapers, 0.80 threshold, 90%+) do the heavy lifting.
- Phase 3: The live demo is the risk. Have a screen-recording fallback queued on Slide 5 in case the network fails. Never apologize for a demo glitch — pivot to the recording without comment.
- Phase 4: Slow down on "ОСМС" and "2GIS" — these are the localization proof points that signal you understand the market.
- Phase 5: Drop your volume by ~20% for the closing. Conviction, not volume. The final line must land like a period, not an exclamation mark.

**РУ**
- Фаза 1: Реквизит-чек обязателен — он превращает абстрактную проблему в физический объект. Держите его все первые 45 секунд.
- Фаза 2: Слегка ускорьтесь на потоке архитектуры. Жюри техническое; пусть цифры (70 скраперов, порог 0.80, >90%) делают основную работу.
- Фаза 3: Живое демо — это риск. Держите наготове скринкаст-запас на Слайде 5 на случай сбоя сети. Никогда не извиняйтесь за сбой демо — без комментариев переключитесь на запись.
- Фаза 4: Замедлитесь на «ОСМС» и «2GIS» — это точки доказательства локализации, сигнализирующие, что вы понимаете рынок.
- Фаза 5: Снизьте громкость примерно на 20% для финала. Убеждённость, а не громкость. Последняя фраза должна встать как точка, а не как восклицательный знак.
