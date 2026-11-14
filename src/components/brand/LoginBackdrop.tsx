import { Basket, BubbleTea, Chopsticks, NoodleBowl, Onigiri, RiceBag } from "./Illustrations";

/**
 * Low-opacity illustrations scattered around the sign-in card — only in the side margins
 * (and below the card on phones), never behind the form fields.
 */
export function LoginBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-25">
      {/* Phones: two icons in the empty space under the card. */}
      <Basket className="absolute bottom-10 left-6 h-20 w-20 -rotate-6 md:hidden" />
      <BubbleTea className="absolute right-8 bottom-16 h-16 w-16 rotate-6 md:hidden" />

      {/* Tablets and desktops: the margins left and right of the centred card. */}
      <div className="hidden md:block">
        <NoodleBowl className="absolute top-[8%] left-[6%] h-24 w-24 -rotate-6 lg:left-[12%]" />
        <RiceBag className="absolute top-[44%] left-[3%] h-20 w-20 rotate-3 lg:left-[20%]" />
        <Chopsticks className="absolute bottom-[8%] left-[9%] h-24 w-24 lg:left-[8%]" />
        <BubbleTea className="absolute top-[10%] right-[7%] h-24 w-24 rotate-6 lg:right-[13%]" />
        <Onigiri className="absolute top-[46%] right-[4%] h-20 w-20 -rotate-3 lg:right-[21%]" />
        <Basket className="absolute right-[9%] bottom-[8%] h-24 w-24 rotate-3 lg:right-[8%]" />
      </div>
    </div>
  );
}
