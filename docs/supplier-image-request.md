# Supplier image request

Most of the shop's products have no photo, and we will not photograph them. The
cleanest source of good photos is the brands themselves. Send the email below
to each brand (or its UAE distributor), starting with the brands at the top of
the table. Contact details are not included on purpose: find the official
distributor on the brand's own website and do not guess.

## Email (English)

**Subject:** Reseller product images and codes request - [Shop name], UAE

Dear [Brand / Distributor name] team,

We are [Shop name], a hardware, electrical, sanitary and paint retailer in the
UAE, and we stock your [brand] products. We are putting our catalogue online
and would like to show your official product photos.

Could you please send us:

1. your reseller image pack (product photos on a white or plain background, JPG or PNG, ideally 800 px or larger);
2. your product codes or SKUs and, if you have them, barcodes, so we can match each photo to the right item;
3. written permission to use these photos on our website and social media, with any usage terms or credit line you require;
4. a current price list or catalogue, if you share one with resellers.

We will use the images only to present your products, and we will credit you
wherever you ask us to.

Thank you for your help.

Kind regards,
[Your name]
[Shop name]
[Phone / WhatsApp]
[Email]
[Shop website or location]

## Arabic (one line)

نرجو تزويدنا بحزمة صور المنتجات الرسمية ورموز المنتجات (SKU) مع إذن كتابي باستخدامها في موقعنا الإلكتروني - [اسم المحل]، [الهاتف].

## Checklist of what to ask

- [ ] Reseller image pack (white background, 800 px or larger, JPG/PNG)
- [ ] Product codes / SKUs, and barcodes if available
- [ ] Written permission to use the photos online (and any credit line required)
- [ ] Whether photos may be edited or cropped to fit a square
- [ ] Whether the pack is updated, and who to contact for new products
- [ ] Current catalogue or price list for resellers
- [ ] Who the official UAE distributor is, if you wrote to the head office

When a pack arrives, put the files in a folder and run
`pnpm --filter @devsfleet/images run import-pack -- --dir <folder> --brand <brand>`
(see [PRODUCT-IMAGES.md](PRODUCT-IMAGES.md)). Keep the permission email: it is
the proof that the photos are ours to use.

## Brands in the price list

Counted from `AL lahiq Products.xlsx` (365 products). 74 products have no
brand or are marked "others"; they are not listed. Brands are shown as typed in
the sheet (lowercase), and some may be the same brand spelled two ways
(check for near-duplicates before emailing).

| Brand | Products |
|---|---|
| modi | 28 |
| kl star | 17 |
| admore | 16 |
| rr | 11 |
| italia | 10 |
| hager | 9 |
| hss | 9 |
| zara | 9 |
| saffron | 8 |
| xuanfeng | 8 |
| ducab | 7 |
| max | 7 |
| osco | 7 |
| roska | 7 |
| asmako | 6 |
| mogen | 6 |
| novex | 6 |
| khaleegia | 5 |
| national paints | 5 |
| al zafeer building materials llc | 4 |
| aqua | 4 |
| khind | 4 |
| oasis | 4 |
| snowlite | 4 |
| al saqr | 3 |
| alva | 3 |
| elsa | 3 |
| milano | 3 |
| robust | 3 |
| sola | 3 |
| artflo | 2 |
| boss | 2 |
| dewalt | 2 |
| eurospring | 2 |
| jumbo | 2 |
| marvel | 2 |
| olfa | 2 |
| pacific | 2 |
| stanley | 2 |
| tuf-fix | 2 |
| volt | 2 |
| zhongdai | 2 |
| adnext | 1 |
| airex | 1 |
| akwa | 1 |
| al nour | 1 |
| alam | 1 |
| amestar | 1 |
| aquabella | 1 |
| atc | 1 |
| bango | 1 |
| bellucci | 1 |
| bison | 1 |
| bosni | 1 |
| cab italiano | 1 |
| clarke | 1 |
| d&l | 1 |
| denacet | 1 |
| dezone | 1 |
| dlc | 1 |
| dongcheng | 1 |
| dore care | 1 |
| elexa | 1 |
| esnceo | 1 |
| euro | 1 |
| faisal nawaz elect. ware tr. | 1 |
| fudex | 1 |
| golden coast | 1 |
| grinder | 1 |
| haneman | 1 |
| hi fi light | 1 |
| hkk | 1 |
| ieko | 1 |
| jisun | 1 |
| king on | 1 |
| lvy | 1 |
| navigate | 1 |
| onyx | 1 |
| optonica | 1 |
| perfect | 1 |
| rak | 1 |
| richi | 1 |
| romex | 1 |
| rosy light | 1 |
| tredex | 1 |
| verrali | 1 |
| veto | 1 |
| vironi | 1 |
| voltex | 1 |
| youmei | 1 |
